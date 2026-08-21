use font_kit::font::Font;
use font_kit::properties::Style;
use font_kit::source::SystemSource;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

/// One concrete installed face. `postscript_name` is the stable CSS/local-font identity.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFaceInfo {
    pub postscript_name: String,
    pub full_name: String,
    pub weight: u16,
    pub weight_label: String,
    pub style: String,
}

/// One visible font family and every face Core Text exposes for the current user.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamilyInfo {
    pub family: String,
    pub monospace: bool,
    pub faces: Vec<FontFaceInfo>,
}

static FONT_CACHE: OnceLock<Mutex<Option<Vec<FontFamilyInfo>>>> = OnceLock::new();

/// Convert the CSS-compatible numeric weight reported by font-kit to a stable UI label.
fn weight_label(weight: u16) -> &'static str {
    match weight {
        0..=150 => "Thin",
        151..=250 => "Extra Light",
        251..=350 => "Light",
        351..=450 => "Regular",
        451..=550 => "Medium",
        551..=650 => "Semibold",
        651..=750 => "Bold",
        751..=850 => "Extra Bold",
        _ => "Black",
    }
}

/// Convert font-kit style metadata to the CSS spelling used by the client bridge.
fn style_name(style: Style) -> &'static str {
    match style {
        Style::Italic => "italic",
        Style::Oblique => "oblique",
        Style::Normal => "normal",
    }
}

/// Build the member label shown in the weight menu, including non-normal styles.
fn face_label(weight: u16, style: &str) -> String {
    match style {
        "italic" => format!("{} Italic", weight_label(weight)),
        "oblique" => format!("{} Oblique", weight_label(weight)),
        _ => weight_label(weight).to_string(),
    }
}

/// Sort and deduplicate faces because Core Text can expose aliases for the same PostScript face.
fn normalize_faces(mut faces: Vec<FontFaceInfo>) -> Vec<FontFaceInfo> {
    faces.sort_by(|left, right| {
        left.weight
            .cmp(&right.weight)
            .then_with(|| left.style.cmp(&right.style))
            .then_with(|| left.postscript_name.cmp(&right.postscript_name))
    });
    let mut names = HashSet::new();
    faces.retain(|face| names.insert(face.postscript_name.to_lowercase()));
    faces
}

/// Ask the platform font database for every enabled family and its concrete faces.
fn scan_system_fonts() -> Result<Vec<FontFamilyInfo>, String> {
    let source = SystemSource::new();
    let mut family_names = source
        .all_families()
        .map_err(|error| format!("list system font families failed: {error}"))?;
    family_names.sort_by_key(|name| name.to_lowercase());
    family_names.dedup_by(|left, right| left.eq_ignore_ascii_case(right));

    let mut families = Vec::with_capacity(family_names.len());
    for family_name in family_names {
        let Ok(handles) = source.select_family_by_name(&family_name) else {
            continue;
        };
        let mut monospace = false;
        let mut faces = Vec::new();
        for handle in handles.fonts() {
            let Ok(font) = Font::from_handle(handle) else {
                continue;
            };
            let Some(postscript_name) = font.postscript_name() else {
                // A face without a local/PostScript identity cannot be selected reliably in WebKit.
                continue;
            };
            if postscript_name.trim().is_empty() {
                continue;
            }
            monospace |= font.is_monospace();
            let properties = font.properties();
            let weight = properties.weight.0.round().clamp(1.0, 1000.0) as u16;
            let style = style_name(properties.style).to_string();
            faces.push(FontFaceInfo {
                postscript_name,
                full_name: font.full_name(),
                weight,
                weight_label: face_label(weight, &style),
                style,
            });
        }

        let faces = normalize_faces(faces);
        if !faces.is_empty() {
            families.push(FontFamilyInfo {
                family: family_name,
                monospace,
                faces,
            });
        }
    }
    Ok(families)
}

/// Return the cached catalog or rescan Core Text when the user explicitly requests a refresh.
pub fn list_system_fonts(refresh: bool) -> Result<Vec<FontFamilyInfo>, String> {
    let cache = FONT_CACHE.get_or_init(|| Mutex::new(None));
    if !refresh {
        if let Some(cached) = cache
            .lock()
            .map_err(|_| "font catalog cache lock poisoned".to_string())?
            .as_ref()
        {
            return Ok(cached.clone());
        }
    }

    let fonts = scan_system_fonts()?;
    *cache
        .lock()
        .map_err(|_| "font catalog cache lock poisoned".to_string())? = Some(fonts.clone());
    Ok(fonts)
}

#[cfg(test)]
mod tests {
    use super::{face_label, normalize_faces, scan_system_fonts, weight_label, FontFaceInfo};

    /// Build a minimal face for deterministic sort/dedup tests without touching Core Text.
    fn face(name: &str, weight: u16, style: &str) -> FontFaceInfo {
        FontFaceInfo {
            postscript_name: name.to_string(),
            full_name: name.to_string(),
            weight,
            weight_label: weight_label(weight).to_string(),
            style: style.to_string(),
        }
    }

    /// Keep the labels aligned with the CSS weight scale and member-style wording.
    #[test]
    fn maps_common_css_weights() {
        assert_eq!(weight_label(100), "Thin");
        assert_eq!(weight_label(400), "Regular");
        assert_eq!(weight_label(500), "Medium");
        assert_eq!(weight_label(600), "Semibold");
        assert_eq!(weight_label(900), "Black");
        assert_eq!(face_label(500, "italic"), "Medium Italic");
        assert_eq!(face_label(400, "oblique"), "Regular Oblique");
    }

    /// Core Text aliases must not produce duplicate options for one selectable face.
    #[test]
    fn sorts_and_deduplicates_postscript_faces() {
        let normalized = normalize_faces(vec![
            face("Example-Bold", 700, "normal"),
            face("Example-Regular", 400, "normal"),
            face("example-regular", 400, "normal"),
        ]);
        assert_eq!(normalized.len(), 2);
        assert_eq!(normalized[0].postscript_name, "Example-Regular");
        assert_eq!(normalized[1].postscript_name, "Example-Bold");
    }

    /// Verify the current macOS session exposes usable PostScript identities end to end.
    #[test]
    fn system_catalog_exposes_selectable_faces() {
        let families = scan_system_fonts().expect("Core Text font catalog should be readable");
        assert!(!families.is_empty());
        assert!(families.iter().all(|family| {
            !family.family.trim().is_empty()
                && family
                    .faces
                    .iter()
                    .all(|face| !face.postscript_name.trim().is_empty())
        }));
        assert!(families.iter().any(|family| family.monospace));
    }
}

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

/// Build a normalized member identifier without including the family name itself.
///
/// Family names can contain words such as "Black" or "Light", so inspecting the whole
/// font name would incorrectly classify a regular face of those families as a named weight.
fn face_member_key(family: &str, postscript_name: &str, full_name: &str) -> String {
    let full_name_suffix = full_name
        .strip_prefix(family)
        .unwrap_or_default()
        .trim_matches(|character: char| {
            character.is_whitespace() || matches!(character, '-' | '_')
        });
    let postscript_suffix = postscript_name
        .rsplit_once('-')
        .map(|(_, suffix)| suffix)
        .unwrap_or_default();

    format!("{full_name_suffix}{postscript_suffix}")
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Infer the real named member when Core Text flattens every face in a TTC to one weight.
///
/// The label intentionally follows the installed face name while the numeric value remains
/// CSS-compatible for WebKit. Unknown names fall back to font-kit's reported metadata.
fn named_weight(member_key: &str) -> Option<(u16, &'static str)> {
    let mappings = [
        ("ultralight", 200, "Ultralight"),
        ("extralight", 200, "Extra Light"),
        ("semilight", 350, "Semilight"),
        ("demilight", 350, "Demi Light"),
        ("extrablack", 950, "Extra Black"),
        ("ultrablack", 950, "Ultra Black"),
        ("extrabold", 800, "Extra Bold"),
        ("ultrabold", 800, "Ultra Bold"),
        ("semibold", 600, "Semibold"),
        ("demibold", 600, "Demi Bold"),
        ("hairline", 100, "Hairline"),
        ("thin", 100, "Thin"),
        ("light", 300, "Light"),
        ("book", 400, "Book"),
        ("regular", 400, "Regular"),
        ("normal", 400, "Regular"),
        ("roman", 400, "Roman"),
        ("medium", 500, "Medium"),
        ("black", 900, "Black"),
        ("heavy", 900, "Heavy"),
        ("bold", 700, "Bold"),
    ];

    mappings
        .into_iter()
        .find(|(name, _, _)| member_key.contains(name))
        .map(|(_, weight, label)| (weight, label))
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
fn face_label(weight_name: &str, style: &str) -> String {
    match style {
        "italic" => format!("{weight_name} Italic"),
        "oblique" => format!("{weight_name} Oblique"),
        _ => weight_name.to_string(),
    }
}

/// Prefer the member name for italic/oblique faces because TTC metadata can flatten style too.
fn face_style(member_key: &str, reported_style: Style) -> &'static str {
    if member_key.contains("italic") {
        "italic"
    } else if member_key.contains("oblique") {
        "oblique"
    } else {
        style_name(reported_style)
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
            let full_name = font.full_name();
            let member_key = face_member_key(&family_name, &postscript_name, &full_name);
            let reported_weight = properties.weight.0.round().clamp(1.0, 1000.0) as u16;
            let (weight, weight_name) = named_weight(&member_key)
                .unwrap_or((reported_weight, weight_label(reported_weight)));
            let style = face_style(&member_key, properties.style).to_string();
            faces.push(FontFaceInfo {
                postscript_name,
                full_name,
                weight,
                weight_label: face_label(weight_name, &style),
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
    use super::{
        face_label, face_member_key, named_weight, normalize_faces, scan_system_fonts,
        weight_label, FontFaceInfo,
    };

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
        assert_eq!(face_label("Medium", "italic"), "Medium Italic");
        assert_eq!(face_label("Regular", "oblique"), "Regular Oblique");
    }

    /// PingFang is a TTC whose Core Text weight can be identical for every loaded member.
    #[test]
    fn identifies_pingfang_members_from_their_face_names() {
        let cases = [
            (
                "PingFangSC-Ultralight",
                "PingFang SC Ultralight",
                200,
                "Ultralight",
            ),
            ("PingFangSC-Thin", "PingFang SC Thin", 100, "Thin"),
            ("PingFangSC-Light", "PingFang SC Light", 300, "Light"),
            ("PingFangSC-Regular", "PingFang SC Regular", 400, "Regular"),
            ("PingFangSC-Medium", "PingFang SC Medium", 500, "Medium"),
            (
                "PingFangSC-Semibold",
                "PingFang SC Semibold",
                600,
                "Semibold",
            ),
        ];

        for (postscript_name, full_name, expected_weight, expected_label) in cases {
            let member_key = face_member_key("PingFang SC", postscript_name, full_name);
            assert_eq!(
                named_weight(&member_key),
                Some((expected_weight, expected_label))
            );
        }
    }

    /// Weight words in a family name must not leak into an otherwise unnamed face.
    #[test]
    fn ignores_weight_words_from_the_family_name() {
        let member_key = face_member_key(
            "Black Han Sans",
            "BlackHanSans-Regular",
            "Black Han Sans Regular",
        );
        assert_eq!(named_weight(&member_key), Some((400, "Regular")));
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

        // PingFang ships with macOS as a TTC and exercises the metadata-flattening fallback.
        let pingfang = families
            .iter()
            .find(|family| family.family == "PingFang SC")
            .expect("PingFang SC should be available on macOS");
        let labels: Vec<&str> = pingfang
            .faces
            .iter()
            .map(|face| face.weight_label.as_str())
            .collect();
        assert!(labels.contains(&"Thin"));
        assert!(labels.contains(&"Regular"));
        assert!(labels.contains(&"Medium"));
        assert!(labels.contains(&"Semibold"));
    }
}

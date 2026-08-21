// dsh-ui 宿主半身：注册 Desktop 字体设置命名空间，并让 client-modules 服务客户端 bundle。

import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";

const FONT_SETTINGS_NAMESPACE = settingsNamespace("desktop-fonts");
const FontSettingsSchema = z.object({
  uiFamily: z.string().default("system"),
  uiPostscriptName: z.string().default(""),
  uiWeight: z.number().default(400),
  codeFamily: z.string().default("system"),
  codePostscriptName: z.string().default(""),
  codeWeight: z.number().default(400),
});

export const name = "dsh-ui";

/** 注册耐久字体配置；真实读写仍由 Harness 官方 settings provider 负责。 */
export function apply(ctx) {
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.settings.register(FONT_SETTINGS_NAMESPACE, FontSettingsSchema);
  });
}

// dsh-theme 宿主半身（Cordis 插件，形态与官方 client 插件一致：{ name, apply }）。
//
// 职责：让本包出现在插件树中（client-modules 借此扫描 dsh.client 声明并服务
// exports["./client"] 的浏览器 bundle）。宿主侧暂不需要额外逻辑；可选的全局
// CSS 兜底（webServer.tapIndex）留到需要时再加。
export const name = "dsh-theme";

export function apply(_ctx) {
  // 宿主半身无副作用；真正的主题注册在浏览器侧 client.js 的 apply() 里完成。
}

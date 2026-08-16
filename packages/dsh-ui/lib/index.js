// dsh-ui 宿主半身（Cordis 插件 { name, apply }）：让包进入插件树，client-modules
// 借此服务 exports["./client"] 的浏览器 bundle。宿主侧暂无逻辑。
export const name = "dsh-ui";

export function apply(_ctx) {
  // 宿主半身无副作用；UI 注册在浏览器侧 client.js 的 apply() 里完成。
}

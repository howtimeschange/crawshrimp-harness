// host 侧:no-op 插件(浏览器侧经 ./client bundle 注入抓虾主题)。
// Loader 需要 name/apply 导出;树的职责仅是让 modules 行扫描到本包的 dsh.client 声明。
export const name = 'crawshrimp-slots'

export function apply(ctx) {
  // 无 host 行为
}

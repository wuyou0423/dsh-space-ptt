// dsh-space-ptt · Host 半边
// 这个插件全部逻辑都在浏览器侧（lib/client.js），Host 侧只需要存在、可加载。
export const name = 'space-ptt'
export const inject = []

export function apply() {
  // 无 Host 侧行为：不注册工具、不注册命令、不改 agent 循环。
}

/** 业务只使用动作语义；原创角色替换时修改此清单及素材，不修改助手。 */
export const CHARACTER_CLIPS = {
  idle: '待机呼吸休闲',
  thinking: '工作状态-思考冒泡',
  working: '工作状态-忙碌点按',
  waiting: '工作状态-原地踱步张望',
  success: '工作状态-雀跃庆祝',
  error: '工作状态-垂头叹气冒汗',
  speaking: '碎碎念-发呆碎碎念',
  interaction: '点击回应-开心跃动',
  dragging: '被鼠标拖拽悬空反馈',
} as const;
export type CharacterMood = keyof typeof CHARACTER_CLIPS;
export const clipUrl = (clip: string) => `/companion/whale/${encodeURIComponent(clip)}.webm`;
export const CHARACTER_POSTER = '/companion/whale/poster.png';

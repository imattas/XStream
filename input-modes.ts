export const inputLabels = {
  controller: 'Controller',
  overlay: 'On-screen controller',
  touch: 'Native touch',
  kbm: 'Keyboard & mouse',
} as const
export type InputMode = keyof typeof inputLabels

export function cloudInputs(types: unknown): InputMode[] {
  const modes: InputMode[] = ['controller', 'overlay']
  if (Array.isArray(types)) {
    if (types.includes('NativeTouch')) modes.push('touch')
    if (types.includes('MKB')) modes.push('kbm')
  }
  return modes
}

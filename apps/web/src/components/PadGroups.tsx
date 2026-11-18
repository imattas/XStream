import type { CSSProperties } from 'react'
import type { Preferences } from '../settings/preferences'

const groups = [
  [['LT','LeftTrigger'],['LB','LeftShoulder'],['L3','LeftThumb'],['↑','DPadUp'],['←','DPadLeft'],['→','DPadRight'],['↓','DPadDown']],
  [['View','View'],['Xbox','Nexus'],['Menu','Menu']],
  [['RB','RightShoulder'],['RT','RightTrigger'],['R3','RightThumb'],['Y','Y'],['X','X'],['B','B'],['A','A']],
] as const

// Positions are percentages of each control group, shared by the live pad and preview.
const positions = [
  [[14,11],[65,11],[14,89],[36,35],[14,52],[58,52],[36,69]],
  [[12,11],[50,11],[88,11]],
  [[35,11],[86,11],[86,89],[64,35],[42,52],[86,52],[64,69]],
]
function position(x: number, y: number) {
  return { '--x': x + '%', '--y': y + '%' } as CSSProperties
}

export function padStyle(p: Preferences) {
  return { '--pad-scale': p.overlayScale / 100, '--pad-inset': p.overlayInset + '%', opacity: p.overlayOpacity / 100 } as CSSProperties
}

export function PadGroups({ preferences }: { preferences: Preferences }) {
  return groups.map((group, index) => <div key={index} className={'pad-group pad-' + index} style={{ bottom: 'max(' + preferences.overlayLift[index] + '%, env(safe-area-inset-bottom))' }}>
      {group.map(([label, field], button) => <button key={field} style={position(positions[index][button][0], positions[index][button][1])} data-button={field} aria-label={field}>{label}</button>)}
      {index !== 1 && <button className="pad-stick" style={position(index === 0 ? 77 : 23, 84)} data-stick={index === 0 ? 'Left' : 'Right'} aria-label={index === 0 ? 'Left stick' : 'Right stick'}>{index === 0 ? 'L' : 'R'}</button>}
    </div>)
}

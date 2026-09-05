import { VersionGraph } from '@start9labs/start-sdk'
import { v0_2_0 } from './v0_2_0'
import { v0_2_1 } from './v0_2_1'
import { v0_2_2 } from './v0_2_2'
import { v0_2_3 } from './v0_2_3'
import { v0_2_4 } from './v0_2_4'
import { v0_2_5 } from './v0_2_5'
import { v0_2_6 } from './v0_2_6'
import { v0_2_7 } from './v0_2_7'
import { v0_2_8 } from './v0_2_8'

// The current version must be listed first; `other` carries the rest of the
// graph so StartOS can find a migration path from whatever version an existing
// install is currently on.
export const versionGraph = VersionGraph.of({
  current: v0_2_8,
  other: [v0_2_0, v0_2_1, v0_2_2, v0_2_3, v0_2_4, v0_2_5, v0_2_6, v0_2_7],
})

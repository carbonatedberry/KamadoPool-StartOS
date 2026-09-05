import { sdk } from '../sdk'
import { config } from './config'
import { poolStatus } from './poolStatus'
import { rebuildShareStats } from './rebuildShareStats'
import { regenTlsCert } from './regenTlsCert'
import { resetLatency } from './resetLatency'
import { showTlsCert } from './showTlsCert'

export const actions = sdk.Actions.of()
  .addAction(config)
  .addAction(poolStatus)
  .addAction(showTlsCert)
  .addAction(regenTlsCert)
  .addAction(resetLatency)
  .addAction(rebuildShareStats)

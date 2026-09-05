import { storeJson } from '../fileModels/store.json'
import { sdk } from '../sdk'

/**
 * Merging {} materializes every `.catch()` default in the store schema, so a
 * fresh install gets a fully-populated store.json and an existing one is
 * healed if fields are missing (e.g. after a restore from an older backup).
 */
export const seedFiles = sdk.setupOnInit(async (effects) => {
  await storeJson.merge(effects, {})
})

import Module from 'ffish-es6';
import { variantsIni } from './boardSpec';
import { rulesLoaded, setRules } from './rules';

let loading: Promise<void> | null = null;

/** Loads ffish in the browser (once) with the game's variants. Files are copied to public/fairy/ at build time. */
export function loadRules(): Promise<void> {
  if (rulesLoaded()) return Promise.resolve();
  loading ??= Module({ locateFile: (file: string) => `${import.meta.env.BASE_URL}fairy/${file}` }).then((ffish) => {
    ffish.loadVariantConfig(variantsIni());
    setRules(ffish);
  });
  return loading;
}

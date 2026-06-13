import { join } from 'node:path';

// The visible module-home directory name (the .zuzuu/ layout).
export const HOME = '.zuzuu';
export const home = (root) => join(root, HOME);

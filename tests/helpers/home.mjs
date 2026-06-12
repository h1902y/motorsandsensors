import { join } from 'node:path';

// The visible faculty-home directory name (the .zuzuu/ layout).
export const HOME = '.zuzuu';
export const home = (root) => join(root, HOME);

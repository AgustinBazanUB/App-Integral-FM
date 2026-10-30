// Extracted from amunozdev/voiceorbs (MIT). See LICENSE.
import { approach } from './orb-state';
export const smoothLevel = (current, target, dt) => approach(current, target, target > current ? 14 : 4, dt);

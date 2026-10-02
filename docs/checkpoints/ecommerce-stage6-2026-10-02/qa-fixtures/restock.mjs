import './guard.mjs';
import {adminGetDocument,adminPatchDocument} from '../../netlify/functions/_lib/firestoreAdminRest.mjs';
const path='locationStock/qa-local/items/qa-product';const before=await adminGetDocument(path);await adminPatchDocument(path,{currentStock:20},{currentUpdateTime:before.updateTime});console.log('Stock QA ficticio=20 para último probe HTTP.');

import {readFile,writeFile} from 'node:fs/promises';
import {buildInvoicePdf} from '../../netlify/functions/_lib/arca/invoicePdf.mjs';
const text=await readFile('tests/arca-invoice-document.test.mjs','utf8');
const issuerEnv=Function('return ('+text.match(/const issuerEnv = ([\s\S]+?);\r?\n\r?\nconst invoice/)[1]+')')();
const template=Function('return ('+text.match(/const invoice = ([\s\S]+?);\r?\n\r?\ntest/)[1]+')')();
issuerEnv.ARCA_ISSUER_LEGAL_NAME='EMISOR QA FICTICIO - MOCK LOCAL';
for(const sourceType of ['admin_quick_sale','seller_sale','ecommerce'])for(const kind of ['A','B']){
 const invoice=structuredClone(template);invoice.sourceType=sourceType;invoice.fiscalEnvironment='homologation';invoice.saleSnapshot.saleCode='QA-MOCK-SIN-EMISION-'+sourceType;
 if(kind==='A'){invoice.authorization.voucherClass='A';invoice.authorization.voucherType=1;invoice.receiverSnapshot={vatConditionId:1,documentType:80,documentNumber:'20164755100',anonymousConsumerFinal:false};invoice.authorization.receiverVatConditionId=1;invoice.authorization.receiverDocument={documentType:80,documentNumber:'20164755100'};}
 const output=buildInvoicePdf({invoice,env:issuerEnv});await writeFile(`.netlify/stage7-qa/pdf-mock-${sourceType}-${kind}.pdf`,output.pdf);
}
console.log('Seis PDFs MOCK del motor local; cero CAE solicitados.');

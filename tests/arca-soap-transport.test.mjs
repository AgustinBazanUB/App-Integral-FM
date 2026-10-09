import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { arcaSoapFetch, requiresWsfeTransport, WSFE_TLS_OPTIONS } from "../netlify/functions/_lib/arca/soapTransport.mjs";

test("WSFE excluye DHE pequeño y conserva TLS y validación de certificado", () => {
  assert.equal(WSFE_TLS_OPTIONS.minVersion, "TLSv1.2");
  assert.equal(WSFE_TLS_OPTIONS.rejectUnauthorized, true);
  assert.match(WSFE_TLS_OPTIONS.ciphers, /:!DHE$/);
  assert.doesNotMatch(WSFE_TLS_OPTIONS.ciphers, /SECLEVEL/);
  assert.equal(requiresWsfeTransport("https://servicios1.afip.gov.ar/wsfev1/service.asmx"), true);
  assert.equal(requiresWsfeTransport("https://wsaa.afip.gov.ar/ws/services/LoginCms"), false);
  assert.equal(requiresWsfeTransport("https://servicios1.afip.gov.ar.example/wsfev1/service.asmx"), false);
});

test("transporte WSFE conserva cuerpo SOAP, acción y señal sin reintentar envíos", async () => {
  const controller = new AbortController();
  let calls=0;
  const result=await arcaSoapFetch("https://servicios1.afip.gov.ar/wsfev1/service.asmx", {method:"POST",headers:{SOAPAction:"FECAESolicitar"},body:"<SOAP/>",signal:controller.signal}, (_url,options,callback) => {
    calls++;
    assert.equal(options.headers.SOAPAction,"FECAESolicitar");
    assert.equal(options.signal,controller.signal);
    assert.equal(options.rejectUnauthorized,true);
    const request=new EventEmitter();
    request.end = body => {
      assert.equal(body,"<SOAP/>");
      const response=new EventEmitter();
      response.statusCode=200;response.headers={"content-type":"text/xml"};
      callback(response);
      response.emit("data",Buffer.from("<result>ok</result>"));response.emit("end");
    };
    return request;
  });
  assert.equal(await result.text(),"<result>ok</result>");
  assert.equal(calls,1);
});

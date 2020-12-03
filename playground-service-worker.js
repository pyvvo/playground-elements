!function(){"use strict";
/**
     * @license
     * Copyright (c) 2019 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */const e=Symbol("Comlink.proxy"),t=Symbol("Comlink.endpoint"),n=Symbol("Comlink.releaseProxy"),s=Symbol("Comlink.thrown"),r=e=>"object"==typeof e&&null!==e||"function"==typeof e,a=new Map([["proxy",{canHandle:t=>r(t)&&t[e],serialize(e){const{port1:t,port2:n}=new MessageChannel;return o(e,t),[n,[n]]},deserialize:e=>(e.start(),l(e,[],undefined))}],["throw",{canHandle:e=>r(e)&&s in e,serialize({value:e}){let t;return t=e instanceof Error?{isError:!0,value:{message:e.message,name:e.name,stack:e.stack}}:{isError:!1,value:e},[t,[]]},deserialize(e){if(e.isError)throw Object.assign(Error(e.value.message),e.value);throw e.value}}]]);function o(t,n=self){n.addEventListener("message",(function r(a){if(!a||!a.data)return;const{id:c,type:l,path:u}=Object.assign({path:[]},a.data),m=(a.data.argumentList||[]).map(f);let h;try{const n=u.slice(0,-1).reduce(((e,t)=>e[t]),t),s=u.reduce(((e,t)=>e[t]),t);switch(l){case 0:h=s;break;case 1:n[u.slice(-1)[0]]=f(a.data.value),h=!0;break;case 2:h=s.apply(n,m);break;case 3:h=function(t){return Object.assign(t,{[e]:!0})}(new s(...m));break;case 4:{const{port1:e,port2:n}=new MessageChannel;o(t,n),h=function(e,t){return p.set(e,t),e}(e,[e])}break;case 5:h=void 0}}catch(e){h={value:e,[s]:0}}Promise.resolve(h).catch((e=>({value:e,[s]:0}))).then((e=>{const[t,s]=d(e);n.postMessage(Object.assign(Object.assign({},t),{id:c}),s),5===l&&(n.removeEventListener("message",r),i(n))}))})),n.start&&n.start()}function i(e){(function(e){return"MessagePort"===e.constructor.name})(e)&&e.close()}function c(e){if(e)throw Error("Proxy has been released and is not useable")}function l(e,s=[],r=function(){}){let a=!1;const o=new Proxy(r,{get(t,r){if(c(a),r===n)return()=>m(e,{type:5,path:s.map((e=>e.toString()))}).then((()=>{i(e),a=!0}));if("then"===r){if(0===s.length)return{then:()=>o};const t=m(e,{type:0,path:s.map((e=>e.toString()))}).then(f);return t.then.bind(t)}return l(e,[...s,r])},set(t,n,r){c(a);const[o,i]=d(r);return m(e,{type:1,path:[...s,n].map((e=>e.toString())),value:o},i).then(f)},apply(n,r,o){c(a);const i=s[s.length-1];if(i===t)return m(e,{type:4}).then(f);if("bind"===i)return l(e,s.slice(0,-1));const[p,d]=u(o);return m(e,{type:2,path:s.map((e=>e.toString())),argumentList:p},d).then(f)},construct(t,n){c(a);const[r,o]=u(n);return m(e,{type:3,path:s.map((e=>e.toString())),argumentList:r},o).then(f)}});return o}function u(e){const t=e.map(d);return[t.map((e=>e[0])),(n=t.map((e=>e[1])),Array.prototype.concat.apply([],n))];var n}const p=new WeakMap;function d(e){for(const[t,n]of a)if(n.canHandle(e)){const[s,r]=n.serialize(e);return[{type:3,name:t,value:s},r]}return[{type:0,value:e},p.get(e)||[]]}function f(e){switch(e.type){case 3:return a.get(e.name).deserialize(e.value);case 0:return e.value}}function m(e,t,n){return new Promise((s=>{const r=[,,,,].fill(0).map((()=>Math.floor(Math.random()*Number.MAX_SAFE_INTEGER).toString(16))).join("-");e.addEventListener("message",(function t(n){n.data&&n.data.id&&n.data.id===r&&(e.removeEventListener("message",t),s(n.data))})),e.start&&e.start(),e.postMessage(Object.assign({id:r},t),n)}))}
/**
     * @license
     * Copyright (c) 2020 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt The complete set of authors may be found
     * at http://polymer.github.io/AUTHORS.txt The complete set of contributors may
     * be found at http://polymer.github.io/CONTRIBUTORS.txt Code distributed by
     * Google as part of the polymer project is also subject to an additional IP
     * rights grant found at http://polymer.github.io/PATENTS.txt
     */
class h{constructor(){this.resolved=!1,this.promise=new Promise((e=>{this._resolve=e}))}resolve(e){this.resolved=!0,this._resolve(e)}}
/**
     * @license
     * Copyright (c) 2019 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */const g=new Map,v={setFileAPI(e,t){let n=g.get(t);(void 0===n||n.resolved)&&(n=new h,g.set(t,n)),n.resolve(e)}};self.addEventListener("fetch",(e=>{const t=e.request.url;if(t.startsWith(self.registration.scope)){const{filePath:n,sessionId:s}=(e=>{const t=self.registration.scope,n=e.substring(t.length),s=n.indexOf("/");let r,a;return-1===s?console.warn("Invalid sample file URL: "+e):(r=n.slice(0,s),a=n.slice(s+1)),{sessionId:r,filePath:a}})(t);void 0!==s&&e.respondWith((async(e,t,n)=>{const s=await(async e=>{let t=g.get(e);if(void 0!==t)return t.promise;const n=await(async e=>{for(const t of await self.clients.matchAll({includeUncontrolled:!0}))if(new URL(t.url).searchParams.get("playground-session-id")===e)return t})(e);if(void 0===n)return;return t=new h,g.set(e,t),n.postMessage({type:5}),t.promise})(n);if(s){const e=await s.getFile(t);if(e){const t=e.contentType?{"Content-Type":e.contentType}:void 0;return new Response(e.content,{headers:t})}}else console.warn("No FileAPI for session "+n);return new Response("404 playground file not found",{status:404})})(0,n,s))}})),self.addEventListener("activate",(e=>{e.waitUntil(self.clients.claim())})),self.addEventListener("install",(()=>{self.skipWaiting()})),self.addEventListener("message",(e=>{if(2===e.data.type){const t={type:4};e.data.port.postMessage(t),o(v,e.data.port)}}))}();

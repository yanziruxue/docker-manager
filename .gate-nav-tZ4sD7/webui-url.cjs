"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var webui_url_exports = {};
__export(webui_url_exports, {
  WEBUI_ZONE_MODE_KEY: () => WEBUI_ZONE_MODE_KEY,
  loadWebuiZoneMode: () => loadWebuiZoneMode,
  nextWebuiZoneMode: () => nextWebuiZoneMode,
  normalizeNavLanUrl: () => normalizeNavLanUrl,
  resolveNavAppUrl: () => resolveNavAppUrl,
  resolveWebuiUrl: () => resolveWebuiUrl
});
module.exports = __toCommonJS(webui_url_exports);
const WEBUI_ZONE_MODE_KEY = "webui-zone-mode";
function loadWebuiZoneMode(store) {
  const v = store.getItem(WEBUI_ZONE_MODE_KEY);
  return v === "intranet" || v === "internet" ? v : "auto";
}
function nextWebuiZoneMode(mode) {
  return mode === "auto" ? "intranet" : mode === "intranet" ? "internet" : "auto";
}
function resolveWebuiUrl(label, mode, zone, loc) {
  const portUrl = label.webuiPort ? `${loc.protocol}//${loc.hostname}:${label.webuiPort}` : "";
  const full = String(label.webuiUrl || "").trim();
  const intranetPick = () => portUrl || full;
  const internetPick = () => full || portUrl;
  if (mode === "intranet") return intranetPick();
  if (mode === "internet") return internetPick();
  return zone === "intranet" ? intranetPick() : internetPick();
}
function normalizeNavLanUrl(lanUrl, loc) {
  const v = String(lanUrl || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith(":")) return `${loc.protocol}//${loc.hostname}${v}`;
  return `${loc.protocol}//${v}`;
}
function resolveNavAppUrl(app, mode, zone, loc) {
  const lan = normalizeNavLanUrl(app.lanUrl || "", loc);
  const wan = String(app.url || "").trim();
  const intranetPick = () => lan || wan;
  const internetPick = () => wan || lan;
  if (mode === "intranet") return intranetPick();
  if (mode === "internet") return internetPick();
  return zone === "intranet" ? intranetPick() : internetPick();
}

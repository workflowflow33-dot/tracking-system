// tracker.js - Script de tracking completo
(function() {
  'use strict';
  
  const API_URL = '/api/track';
  
  // Função SHA256 com fallback
  async function sha256(str) {
    try {
      if (!crypto || !crypto.subtle || !crypto.subtle.digest) {
        console.warn("crypto.subtle não disponível, usando fallback");
        return simpleHash(str);
      }
      
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (err) {
      console.error("Erro no SHA256:", err);
      return simpleHash(str);
    }
  }
  
  // Hash simples como fallback
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(16, '0');
  }
  
  // CRC32
  function crc32(str) {
    const makeCRCTable = () => {
      let c;
      const crcTable = [];
      for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) {
          c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        crcTable[n] = c;
      }
      return crcTable;
    };
    
    const crcTable = makeCRCTable();
    let crc = 0 ^ (-1);
    
    for (let i = 0; i < str.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ str.charCodeAt(i)) & 0xFF];
    }
    
    return ((crc ^ (-1)) >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }
  
  // Gera fingerprint do navegador
  async function getBrowserFingerprint() {
    const components = [
      navigator.userAgent,
      navigator.language,
      navigator.platform,
      navigator.hardwareConcurrency || 0,
      navigator.deviceMemory || 0,
      screen.width + "x" + screen.height,
      screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      !!window.TouchEvent,
      navigator.doNotTrack
    ];
    return await sha256(components.join("||"));
  }
  
  // Audio fingerprint completo
  async function getAudioSignature() {
    try {
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtx) {
        console.warn("OfflineAudioContext não suportado");
        return "UNSUPPORTED";
      }
      
      const ctx = new OfflineCtx(1, 256, 44100);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 10000;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(0);
      
      const rendered = await ctx.startRendering();
      const data = rendered.getChannelData(0);
      let s = 0;
      for (let i = 0; i < data.length; i += 4) s += Math.abs(data[i]);
      const result = String(Math.round(s * 1000000));
      console.log("Audio signature gerada:", result);
      return result;
    } catch (err) {
      console.error("Erro ao gerar audio fingerprint:", err);
      return "ERROR";
    }
  }
  
  // Busca dados completos de IP com fallback
  async function fetchIPData() {
    try {
      let r = await fetch("https://ipapi.co/json/");
      if (!r.ok) throw new Error("ipapi falhou");
      let data = await r.json();
      if (data.error || !data.ip) throw new Error("ipapi limitou");
      return data;
    } catch (err) {
      console.warn("Primeira API falhou, tentando ip-api.com...");
      try {
        let r2 = await fetch("http://ip-api.com/json/");
        if (!r2.ok) throw new Error("ip-api falhou");
        let data2 = await r2.json();
        if (data2.status !== "success") throw new Error("ip-api falhou");
        return {
          ip: data2.query,
          city: data2.city,
          region: data2.regionName,
          country_code: data2.countryCode,
          country_name: data2.country,
          timezone: data2.timezone,
          utc_offset: null,
          org: data2.isp,
          country_population: null,
          country_calling_code: null,
          currency_name: null,
          currency: null,
          languages: null,
          country_capital: null,
          latitude: data2.lat,
          longitude: data2.lon
        };
      } catch (err2) {
        console.warn("Segunda API falhou, tentando ipify.org...");
        let r3 = await fetch("https://api.ipify.org/?format=json");
        if (!r3.ok) throw new Error("ipify falhou");
        let data3 = await r3.json();
        if (!data3.ip) throw new Error("ipify falhou");
        return {
          ip: data3.ip,
          city: "N/D",
          region: "N/D",
          country_code: "N/D",
          country_name: "N/D",
          timezone: null,
          utc_offset: null,
          org: "N/D"
        };
      }
    }
  }
  
  // Corrige o estado usando API de geocoding
  async function correctLocation(city, countryCode, region) {
    try {
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=pt`
      );
      const geoData = await geoRes.json();
      
      if (geoData.results && geoData.results.length > 0) {
        const match = geoData.results.find(c => c.country_code === countryCode);
        if (match) {
          return {
            correctedRegion: match.admin1 || region,
            correctedCountry: match.country || null
          };
        }
      }
      return { correctedRegion: region, correctedCountry: null };
    } catch (err) {
      console.error("Erro ao corrigir localização:", err);
      return { correctedRegion: region, correctedCountry: null };
    }
  }
  
  // Envia dados completos para o backend
  async function sendTrackingData() {
    try {
      console.log("🔍 Iniciando coleta de dados de tracking...");
      
      // Gera fingerprints
      const fingerprint = await getBrowserFingerprint();
      console.log("✅ Fingerprint gerado:", fingerprint.substring(0, 16) + "...");
      
      const audioSig = await getAudioSignature();
      const audioCRC = audioSig !== "ERROR" && audioSig !== "UNSUPPORTED" 
        ? crc32(audioSig) 
        : "N/D";
      console.log("✅ Audio CRC32:", audioCRC);
      
      // Busca dados de IP
      const ipData = await fetchIPData();
      console.log("✅ Dados de IP obtidos:", ipData.ip);
      
      // Corrige localização
      let correctedData = null;
      if (ipData.city !== "N/D") {
        correctedData = await correctLocation(ipData.city, ipData.country_code, ipData.region);
        console.log("✅ Localização corrigida:", correctedData.correctedRegion);
      }
      
      // Hora local e fuso do computador
const localDate = new Date();
const localTime = localDate.toTimeString().split(' ')[0]; // Hora local
const gmtOffsetMinutes = localDate.getTimezoneOffset();
const gmtOffsetHours = -gmtOffsetMinutes / 60; // GMT positivo/negativo

// Função para detectar tipo de dispositivo
function detectDeviceType() {
  const ua = navigator.userAgent;
  if (/Mobi|Android/i.test(ua)) return 'Mobile';
  if (/Tablet|iPad/i.test(ua)) return 'Tablet';
  return 'Desktop';
}

// Montagem do objeto trackingData
const trackingData = {
  fingerprint,
  audioSignature: audioCRC,
  audioSignatureRaw: audioSig,
  ip: ipData.ip,
  city: ipData.city,
  region: ipData.region,
  correctedRegion: correctedData?.correctedRegion || ipData.region,
  country: ipData.country_name,
  countryCode: ipData.country_code,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, // Fuso do computador
  gmtOffset: gmtOffsetHours,   // GMT do computador
  localTime: localTime,        // Hora local do computador
  deviceType: detectDeviceType(), // Desktop, Mobile ou Tablet
  utcOffset: ipData.utc_offset,
  org: ipData.org,
  countryPopulation: ipData.country_population,
  countryCallingCode: ipData.country_calling_code,
  currencyName: ipData.currency_name,
  currency: ipData.currency,
  languages: ipData.languages,
  countryCapital: ipData.country_capital,
  latitude: ipData.latitude,
  longitude: ipData.longitude,
  userAgent: navigator.userAgent,
  language: navigator.language,
  platform: navigator.platform,
  hardwareConcurrency: navigator.hardwareConcurrency || 0,
  deviceMemory: navigator.deviceMemory || 0,
  screen: `${screen.width}x${screen.height}`,
  colorDepth: screen.colorDepth,
  touchSupport: !!window.TouchEvent,
  doNotTrack: navigator.doNotTrack,
  timestamp: new Date().toISOString(),
  referrer: document.referrer || 'Direct',
  page: window.location.href,

  // Detecção de ambiente
  isLocalhost: ipData.ip === "127.0.0.1" || 
               ipData.ip.startsWith("192.168.") || 
               ipData.ip.startsWith("10.") || 
               ipData.ip.startsWith("172.") || 
               ipData.ip === "::1"
};
      
      // Envia para o backend
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(trackingData)
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Tracking enviado com sucesso:', result);
      } else {
        console.error('❌ Erro HTTP:', response.status);
      }
    } catch (error) {
      console.error('❌ Erro ao enviar tracking:', error);
    }
  }
  
  // Executa o tracking quando a página carregar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sendTrackingData);
  } else {
    sendTrackingData();
  }
  
})();
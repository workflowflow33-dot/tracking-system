// server.js - Backend API para tracking completo (RENDER READY)
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// ⭐ IMPORTANTE: Usar porta do ambiente (Render fornece automaticamente)
const PORT = process.env.PORT || 3000;

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Armazenamento em memória
const visitors = new Map();
const sessions = [];

// Função para gerar ID único do visitante
function generateVisitorID(data) {
  const components = [
    data.ip || 'unknown',
    data.audioSignatureRaw || data.audioSignature || 'unknown',
    data.userAgent || 'unknown',
    data.platform || 'unknown'
  ];
  
  const str = components.join('||');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// Função para verificar mudanças
function detectChanges(lastSession, currentData) {
  const changes = {
    locationChanged: false,
    deviceChanged: false,
    screenChanged: false,
    ipChanged: false
  };
  
  if (!lastSession) return changes;
  
  if (lastSession.city !== currentData.city && currentData.city !== 'N/D') {
    changes.locationChanged = true;
  }
  
  if (lastSession.audioSignature !== currentData.audioSignature && 
      currentData.audioSignature !== 'N/D') {
    changes.deviceChanged = true;
  }
  
  if (lastSession.screen !== currentData.screen) {
    changes.screenChanged = true;
  }
  
  if (lastSession.clientIP !== currentData.ip) {
    changes.ipChanged = true;
  }
  
  return changes;
}

// Endpoint para receber dados de tracking
app.post('/api/track', async (req, res) => {
  try {
    const data = req.body;

    const visitorID = generateVisitorID(data);
    
    const detectedIP = data.ip || 
                       req.headers['x-forwarded-for']?.split(',')[0] || 
                       req.headers['x-real-ip'] || 
                       req.socket.remoteAddress;

    const isReturning = visitors.has(visitorID);
    const existingVisitor = visitors.get(visitorID);
    
    const lastSession = existingVisitor?.sessions[existingVisitor.sessions.length - 1];
    const changes = detectChanges(lastSession, data);

    const sessionData = {
      id: Date.now() + Math.random(),
      visitorID,
      fingerprint: data.fingerprint,
      audioSignature: data.audioSignature,
      audioSignatureRaw: data.audioSignatureRaw,
      
      clientIP: data.ip,
      serverDetectedIP: detectedIP,
      isLocalhost: data.isLocalhost,
      
      city: data.city,
      region: data.region,
      correctedRegion: data.correctedRegion,
      country: data.country,
      countryCode: data.countryCode,
      latitude: data.latitude,
      longitude: data.longitude,
      
      timezone: data.timezone,
      utcOffset: data.utcOffset,
      localTime: data.localTime,
      gmtOffset: data.gmtOffset,
      
      deviceType: data.deviceType,
      org: data.org,
      
      countryPopulation: data.countryPopulation,
      countryCallingCode: data.countryCallingCode,
      currencyName: data.currencyName,
      currency: data.currency,
      languages: data.languages,
      countryCapital: data.countryCapital,
      
      userAgent: data.userAgent,
      language: data.language,
      platform: data.platform,
      hardwareConcurrency: data.hardwareConcurrency,
      deviceMemory: data.deviceMemory,
      screen: data.screen,
      colorDepth: data.colorDepth,
      touchSupport: data.touchSupport,
      doNotTrack: data.doNotTrack,
      
      referrer: data.referrer,
      page: data.page,
      
      ...changes,
      isReturning,
      
      timestamp: data.timestamp || new Date().toISOString(),
      firstSeen: new Date().toISOString()
    };

    if (isReturning) {
      existingVisitor.visits++;
      existingVisitor.lastSeen = new Date().toISOString();
      existingVisitor.sessions.push(sessionData);
      
      if (changes.locationChanged) {
        console.log(`🚩 Mudança de localização: ${lastSession.city} → ${data.city}`);
      }
      if (changes.deviceChanged) {
        console.log(`💻 Mudança de dispositivo detectada`);
      }
      if (changes.screenChanged) {
        console.log(`🖥️ Mudança de tela: ${lastSession.screen} → ${data.screen}`);
      }
      if (changes.ipChanged) {
        console.log(`🌐 Mudança de IP: ${lastSession.clientIP} → ${data.ip}`);
      }
    } else {
      visitors.set(visitorID, {
        visitorID,
        fingerprint: data.fingerprint,
        visits: 1,
        firstSeen: sessionData.firstSeen,
        lastSeen: sessionData.firstSeen,
        sessions: [sessionData]
      });
      console.log(`🆕 NOVO visitante único: ${visitorID}`);
    }

    sessions.push(sessionData);

    const emoji = isReturning ? '🔄' : '✅';
    console.log(`${emoji} Sessão: ${data.city}, ${data.correctedRegion} | IP: ${data.ip || detectedIP}`);

    res.json({
      success: true,
      message: 'Tracking registrado',
      data: sessionData
    });

  } catch (error) {
    console.error('❌ Erro no tracking:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao processar tracking'
    });
  }
});

// Endpoint para listar sessões
app.get('/api/sessions', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const recentSessions = sessions.slice(-limit).reverse();
  
  res.json({
    success: true,
    total: sessions.length,
    sessions: recentSessions
  });
});

// Endpoint para estatísticas
app.get('/api/stats', (req, res) => {
  const uniqueVisitors = visitors.size;
  const totalSessions = sessions.length;
  
  const countries = {};
  const cities = {};
  const browsers = {};
  const platforms = {};
  const devices = {};
  const timezones = {};
  const languages = {};
  
  sessions.forEach(session => {
    if (session.country) {
      countries[session.country] = (countries[session.country] || 0) + 1;
    }
    
    if (session.city && session.city !== "N/D") {
      const cityKey = `${session.city}, ${session.correctedRegion}`;
      cities[cityKey] = (cities[cityKey] || 0) + 1;
    }
    
    const browser = session.userAgent.match(/(Chrome|Firefox|Safari|Edge|Opera)/)?.[0] || 'Other';
    browsers[browser] = (browsers[browser] || 0) + 1;
    
    platforms[session.platform] = (platforms[session.platform] || 0) + 1;
    
    if (session.audioSignature && session.audioSignature !== "N/D") {
      devices[session.audioSignature] = (devices[session.audioSignature] || 0) + 1;
    }
    
    if (session.timezone) {
      timezones[session.timezone] = (timezones[session.timezone] || 0) + 1;
    }
    
    if (session.language) {
      languages[session.language] = (languages[session.language] || 0) + 1;
    }
  });
  
  let returningVisitors = 0;
  visitors.forEach(visitor => {
    if (visitor.visits > 1) returningVisitors++;
  });
  
  const returnRate = uniqueVisitors > 0 
    ? ((returningVisitors / uniqueVisitors) * 100).toFixed(1) 
    : 0;

  res.json({
    success: true,
    stats: {
      uniqueVisitors,
      totalSessions,
      returningVisitors,
      returnRate: returnRate + '%',
      uniqueDevices: Object.keys(devices).length,
      countries,
      cities,
      browsers,
      platforms,
      devices,
      timezones,
      languages
    }
  });
});

// Rota principal redireciona para o dashboard
app.get('/', (req, res) => {
  res.redirect('/dashboard.html');
});

// ⭐ IMPORTANTE: Bind em 0.0.0.0 para funcionar no Render
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 SERVIDOR DE TRACKING INICIADO!');
  console.log('='.repeat(60));
  console.log(`📍 Porta: ${PORT}`);
  console.log(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(60) + '\n');
});
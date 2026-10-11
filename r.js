// ScrimDesk player registration form. Reads the tournament from ?d= (base64url JSON written by the
// app's FormLink) and sends the registration to the organizer's Firebase project (Cloud Firestore).
// The ScrimDesk app downloads it into Pending and then deletes it from the server.
// Field names and limits must match FirestoreDocuments in the app and firebase/firestore.rules.
(function () {
  'use strict';

  // Same two values as AppConfig.FIREBASE_PROJECT_ID and FIREBASE_API_KEY in the app.
  // The API key only identifies the project; firestore.rules decides what anyone may write.
  var FIREBASE = { projectId: 'scrimdesk-bf279', apiKey: 'AIzaSyB4B78cagCvzkdh9SAgGy1G7pSOhiotvsc' };

  var MAX_PLAYERS = 6;
  var FIRST_ROWS = 4;
  // firestore.rules allows 800,000 bytes for the screenshot and 150,000 for the logo.
  var SHOT_MAX_BYTES = 700000;
  var LOGO_MAX_BYTES = 120000;

  // Strictly checked mobile numbers (same rules as the app's PhoneNumber); every other country only
  // has to be a plausible length.
  var STRICT = {
    '92': { mobile: /^3\d{9}$/, hint: '300 1234567' },
    '91': { mobile: /^[6-9]\d{9}$/, hint: '98765 43210' },
    '880': { mobile: /^1[3-9]\d{8}$/, hint: '1712 345678' },
    '977': { mobile: /^9[6-8]\d{8}$/, hint: '984 1234567' }
  };
  // Links made before the "dc" key existed only came from these four countries.
  var LEGACY_DIAL = { PKR: '92', INR: '91', BDT: '880', NPR: '977' };
  // Same symbols as the app's Currency; anything else is written with its code ("KES 300").
  var SYMBOLS = {
    AUD: 'A$', BDT: '\u09F3', BRL: 'R$', CAD: 'CA$', CNY: '\u00A5', EGP: 'E\u00A3', EUR: '\u20AC', GBP: '\u00A3', GHS: 'GH\u20B5',
    HKD: 'HK$', IDR: 'Rp', ILS: '\u20AA', INR: '\u20B9', JPY: '\u00A5', KES: 'KSh', KRW: '\u20A9', KZT: '\u20B8', LKR: 'Rs',
    MXN: 'MX$', MYR: 'RM', NGN: '\u20A6', NPR: 'Rs', NZD: 'NZ$', PHP: '\u20B1', PKR: 'Rs', PLN: 'z\u0142', RUB: '\u20BD',
    SGD: 'S$', THB: '\u0E3F', TRY: '\u20BA', TWD: 'NT$', UAH: '\u20B4', USD: '$', VND: '\u20AB', ZAR: 'R'
  };
  var INDIAN_GROUPING = { INR: true, BDT: true, NPR: true };
  var GAMES = { FREE_FIRE: 'Free Fire', PUBG_MOBILE: 'PUBG Mobile', BGMI: 'BGMI', COD_MOBILE: 'COD Mobile' };
  var METHODS = {
    JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa', UPI: 'UPI', BKASH: 'bKash', ESEWA: 'eSewa',
    BANK: 'Bank transfer', MOBILE_WALLET: 'Mobile wallet', OTHER: 'Payment'
  };

  function $(id) { return document.getElementById(id); }
  function show(id) {
    ['loading', 'offline', 'broken', 'closed', 'register', 'done'].forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
    if (id === 'done') celebrate();
  }

  // ---- Reading the link ----

  function readPayload() {
    var match = /[?#&]d=([A-Za-z0-9_\-=]+)/.exec(location.search + location.hash);
    if (!match) return null;
    try {
      var b64 = match[1].replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var binary = atob(b64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      var ok = p && typeof p.c === 'string' && p.c && typeof p.n === 'string' && p.n &&
        typeof p.t === 'number' && typeof p.f === 'number' && typeof p.tt === 'number' &&
        /^[A-Z]{3}$/.test(p.cur) && typeof p.wa === 'string' && /^\+\d{8,15}$/.test(p.wa) && typeof p.pn === 'string';
      return ok ? p : null;
    } catch (e) {
      return null;
    }
  }

  // Short links (?t=): the tournament id, a UUID written as 22 base64url characters (FormLink.short in the
  // app). Anything else is taken as the id itself.
  function readTournamentId() {
    var match = /[?#&]t=([A-Za-z0-9_-]{1,64})/.exec(location.search + location.hash);
    if (!match) return null;
    var token = match[1];
    if (token.length !== 22) return token;
    try {
      var binary = atob(token.replace(/-/g, '+').replace(/_/g, '/') + '==');
      var hex = '';
      for (var i = 0; i < binary.length; i++) hex += ('0' + binary.charCodeAt(i).toString(16)).slice(-2);
      return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    } catch (e) {
      return null;
    }
  }

  // The tournament's server document (FormDetails in the app) as the same object a ?d= link carries.
  function payloadFrom(id, fields) {
    function text(key) { return fields[key] && typeof fields[key].stringValue === 'string' ? fields[key].stringValue : ''; }
    function number(key) { var value = intValue(fields[key]); return value === null || isNaN(value) ? 0 : value; }
    if (!text('name') || !fields.startAt) return null;
    return {
      i: id, n: text('name'), g: text('game'), t: number('startAt'), tt: number('teams'), f: number('fee'),
      p: number('prize'), cur: text('currency'), pm: text('payMethod'), pn: text('payNumber'), dc: text('dial')
    };
  }

  // ---- Formatting (same rules as the app's Money) ----

  function group(amount, indian) {
    var digits = String(Math.abs(Math.round(amount)));
    if (digits.length <= 3) return digits;
    var head = digits.slice(0, -3);
    var size = indian ? 2 : 3;
    var parts = [];
    while (head.length > size) { parts.unshift(head.slice(-size)); head = head.slice(0, -size); }
    parts.unshift(head);
    return parts.join(',') + ',' + digits.slice(-3);
  }

  function money(amount, cur) {
    var symbol = SYMBOLS[cur] || cur;
    var grouped = group(amount, !!INDIAN_GROUPING[cur]);
    return symbol.length > 1 ? symbol + ' ' + grouped : symbol + grouped;
  }

  // ---- Phone numbers (mirrors PhoneNumber.normalize in the app) ----

  // Arabic-Indic, Extended Arabic-Indic, Devanagari and Bengali digits count too.
  var DIGIT_ZEROS = [0x30, 0x660, 0x6F0, 0x966, 0x9E6];

  function digitsOf(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      for (var z = 0; z < DIGIT_ZEROS.length; z++) {
        if (code >= DIGIT_ZEROS[z] && code <= DIGIT_ZEROS[z] + 9) { out += String(code - DIGIT_ZEROS[z]); break; }
      }
    }
    return out;
  }

  function plausible(dial, national) {
    var rule = STRICT[dial];
    if (rule) return rule.mobile.test(national);
    if (!national || national.charAt(0) === '0' || dial.length + national.length > 15) return false;
    return dial === '1' ? national.length === 10 : national.length >= 6 && national.length <= 13;
  }

  // "+..." numbers: the strict countries are checked properly, others only need a plausible length.
  function fromInternational(digits) {
    for (var dial in STRICT) {
      if (digits.indexOf(dial) === 0) {
        var national = digits.slice(dial.length).replace(/^0/, '');
        return plausible(dial, national) ? '+' + dial + national : null;
      }
    }
    return digits.length >= 8 && digits.length <= 15 && digits.charAt(0) !== '0' ? '+' + digits : null;
  }

  function normalizePhone(input, dial) {
    var trimmed = input.trim();
    var digits = digitsOf(trimmed);
    if (!digits) return null;
    if (trimmed.charAt(0) === '+') return fromInternational(digits);
    if (digits.indexOf('00') === 0) return fromInternational(digits.slice(2));
    if (!dial) return fromInternational(digits);
    var national = digits.replace(/^0/, '');
    if (plausible(dial, national)) return '+' + dial + national;
    // Typed with the country code but without "+" (only trusted for strictly checked countries).
    for (var code in STRICT) {
      if (digits.indexOf(code) === 0 && plausible(code, digits.slice(code.length))) return '+' + digits;
    }
    return null;
  }

  // Line and paragraph separators too, so a pasted name can't break into several lines.
  var LINE_BREAKS = new RegExp('[\\r\\n' + String.fromCharCode(0x2028, 0x2029) + ']+', 'g');

  function oneLine(text) {
    return text.replace(LINE_BREAKS, ' ').replace(/\s+/g, ' ').trim();
  }

  // ---- Images: resized and re-encoded as JPEG in the browser, so they fit in one document ----

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  }

  function encode(img, maxSide, quality) {
    var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', quality); });
  }

  // Tries smaller sizes and lower quality until the JPEG fits in maxBytes.
  function compress(file, steps, maxBytes) {
    return loadImage(file).then(function (img) {
      var i = 0;
      function attempt() {
        var step = steps[i];
        return encode(img, step[0], step[1]).then(function (blob) {
          if (blob && (blob.size <= maxBytes || i === steps.length - 1)) return blob;
          i++;
          return attempt();
        });
      }
      return attempt();
    }).then(function (blob) {
      if (!blob || blob.size > maxBytes) throw new Error('too big');
      return blob;
    });
  }

  function base64Of(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ---- Server ----

  function tournamentUrl(id) {
    return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(FIREBASE.projectId) +
      '/databases/(default)/documents/tournaments/' + encodeURIComponent(id);
  }

  function documentsUrl() { return tournamentUrl(p.i); }

  function str(value) { return { stringValue: value }; }

  // Same 20-character ids Firestore picks itself.
  function newId() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    var id = '';
    for (var i = 0; i < bytes.length; i++) id += chars.charAt(bytes[i] % chars.length);
    return id;
  }

  // One request: save the registration and add 1 to the tournament's "registered" count
  // (firestore.rules only allows that +1 together with a new registration).
  function commitBody(fields, id) {
    var tournament = 'projects/' + FIREBASE.projectId + '/databases/(default)/documents/tournaments/' + p.i;
    return {
      writes: [
        { update: { name: tournament + '/registrations/' + id, fields: fields }, currentDocument: { exists: false } },
        {
          update: { name: tournament, fields: { lastId: str(id) } },
          updateMask: { fieldPaths: ['lastId'] },
          updateTransforms: [{ fieldPath: 'registered', increment: { integerValue: '1' } }],
          currentDocument: { exists: true }
        }
      ]
    };
  }

  // "3 / 16" in the tournament card, and a note once every slot has a registration.
  function showRegistered(count) {
    if (typeof count !== 'number' || !(count >= 0)) return;
    countUp($('teams'), count, ' / ' + p.tt);
    $('teams-label').textContent = 'Registered';
    $('slots').hidden = false;
    var left = p.tt - count;
    $('slots-left').textContent = left === 1 ? '1 slot left' : left + ' slots left';
    // Only when the box has the row to itself; once every slot is taken the note below says so.
    $('slots-left').hidden = !!p.p || p.f > 0 || left <= 0;
    setTimeout(function () { $('slots-fill').style.width = Math.min(100, Math.round(count / p.tt * 100)) + '%'; }, 60);
    var note = $('full-note');
    note.hidden = count < p.tt;
    note.textContent = 'All ' + p.tt + ' slots have a registration. You can still register: the organizer picks the teams.';
  }

  function intValue(field) {
    var value = field && field.integerValue;
    return value === undefined ? null : Number(value);
  }

  function registrationDocument(r) {
    var fields = {
      teamName: str(r.team),
      name: str(r.person),
      whatsapp: str(r.phone),
      shot: { bytesValue: r.shot }
    };
    if (r.tag) fields.teamTag = str(r.tag);
    if (r.logo) fields.logo = { bytesValue: r.logo };
    if (r.players.length) {
      fields.players = {
        arrayValue: {
          values: r.players.map(function (pl) {
            return { mapValue: { fields: { name: str(pl.name), uid: str(pl.uid) } } };
          })
        }
      };
    }
    return { fields: fields };
  }

  // ---- Motion ----

  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // "0 / 16" counting up to "3 / 16".
  function countUp(el, to, suffix) {
    if (REDUCED || to <= 0) { el.textContent = to + suffix; return; }
    var start = performance.now();
    function step(now) {
      var t = Math.min(1, (now - start) / 900);
      el.textContent = Math.round((1 - Math.pow(1 - t, 3)) * to) + suffix;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function celebrate() {
    if (REDUCED) return;
    var box = $('confetti');
    var colors = ['#e8533f', '#ff8a3d', '#ffd166', '#3dbe74', '#7b61ff', '#4cc9f0'];
    for (var i = 0; i < 90; i++) {
      var piece = document.createElement('i');
      piece.style.left = (Math.random() * 100).toFixed(1) + '%';
      piece.style.width = (6 + Math.random() * 6).toFixed(1) + 'px';
      piece.style.height = (9 + Math.random() * 9).toFixed(1) + 'px';
      piece.style.background = colors[i % colors.length];
      piece.style.animationDuration = (2.6 + Math.random() * 1.8).toFixed(2) + 's';
      piece.style.animationDelay = (0.5 + Math.random() * 0.7).toFixed(2) + 's';
      piece.style.setProperty('--drift', Math.round(Math.random() * 200 - 100) + 'px');
      piece.style.setProperty('--spin', Math.round(360 + Math.random() * 1080) + 'deg');
      box.appendChild(piece);
    }
    setTimeout(function () { box.textContent = ''; }, 6000);
  }

  // ---- Country code (same countries and search as the app's country picker) ----

  var COUNTRIES = (window.SD_COUNTRIES || []).map(function (c) { return { iso: c[0], name: c[1], dial: c[2] }; });
  var PRIMARY = window.SD_PRIMARY_FOR_SHARED_DIAL || [];
  var country = null;
  // Accents don't matter in search: "aland" finds the Aland Islands with its ring.
  var MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36F) + ']', 'g');

  function plain(text) {
    return (text.normalize ? text.normalize('NFD').replace(MARKS, '') : text).toLowerCase();
  }

  function flagOf(iso) {
    return String.fromCodePoint(0x1F1E6 + iso.charCodeAt(0) - 65, 0x1F1E6 + iso.charCodeAt(1) - 65);
  }

  // Countries sharing a code (+1, +44 ...) default to the main one, as in the app.
  function countryForDial(code) {
    var matches = COUNTRIES.filter(function (c) { return c.dial === code; });
    return matches.filter(function (c) { return PRIMARY.indexOf(c.iso) >= 0; })[0] || matches[0] || null;
  }

  // Digits ("+44", "44") match dial codes; text matches names that start with it first, then names that
  // contain it and ISO codes ("GB").
  function searchCountries(query) {
    var q = plain(query.trim());
    if (!q) return COUNTRIES;
    var digits = q.charAt(0) === '+' ? q.slice(1) : q;
    if (/^[0-9]+$/.test(digits)) return COUNTRIES.filter(function (c) { return c.dial.indexOf(digits) === 0; });
    var starts = COUNTRIES.filter(function (c) { return plain(c.name).indexOf(q) === 0; });
    return starts.concat(COUNTRIES.filter(function (c) {
      return starts.indexOf(c) < 0 && (plain(c.name).indexOf(q) >= 0 || c.iso.toLowerCase() === q);
    }));
  }

  function setCountry(c) {
    country = c;
    dial = c ? c.dial : '';
    $('cc-flag').textContent = c ? flagOf(c.iso) : '';
    $('dial').textContent = c ? '+' + c.dial : 'Code';
    $('cc-button').setAttribute('aria-label', c ? 'Country code ' + c.name + ' +' + c.dial + ', change' : 'Choose country code');
    $('wa').placeholder = STRICT[dial] ? STRICT[dial].hint : (dial ? 'Phone number' : 'With country code');
  }

  // ---- Page ----

  var p = readPayload();
  var linkId = p ? null : readTournamentId();
  if (!p && !linkId) {
    show('broken');
    return;
  }
  if (p && !p.i) {
    $('broken-text').textContent = 'This link is from an older version of ScrimDesk. Ask the organizer to share the tournament again.';
    show('broken');
    return;
  }
  if (!FIREBASE.projectId || !FIREBASE.apiKey) {
    $('closed-text').textContent = 'Online registration isn\'t set up yet. Ask the organizer how to register.';
    show('closed');
    return;
  }

  var dial = '';

  // The tournament card, the payment number and the player's country code.
  function fill() {
    dial = /^\d{1,4}$/.test(p.dc || '') ? p.dc : (LEGACY_DIAL[p.cur] || '');
    document.title = p.n + ' \u00B7 Registration';
    $('game').textContent = GAMES[p.g] || 'Tournament';
    $('name').textContent = p.n;
    // Tournaments made after the app dropped the prize step carry no prize or fee: the poster shows them.
    $('prize').textContent = p.p ? money(p.p, p.cur) : '';
    $('prize-fact').hidden = !p.p;
    $('fee').textContent = p.f > 0 ? money(p.f, p.cur) : '';
    $('fee-fact').hidden = !(p.f > 0);
    $('teams').textContent = String(p.tt);
    // Players usually live where the organizer does, so the organizer's code comes first.
    setCountry(countryForDial(dial));
    $('method').textContent = (METHODS[p.pm] || 'Payment') + (p.f > 0 ? ' \u00B7 ' + money(p.f, p.cur) : '');
    $('number').textContent = p.pn || '\u2013';
    $('pay-info').hidden = !p.pn;
    show('register');
  }

  // Open or closed (full, started or deleted), and "3 / 16 registered".
  function applyStatus(fields) {
    showRegistered(intValue(fields.registered) || 0);
    if (!(fields.open && fields.open.booleanValue === true)) show('closed');
  }

  if (p) {
    fill();
    // Already closed? Say so before anyone fills in the form.
    fetch(documentsUrl() + '?key=' + encodeURIComponent(FIREBASE.apiKey))
      .then(function (response) {
        if (response.status === 404) { show('closed'); return; }
        if (response.ok) return response.json().then(function (doc) { applyStatus((doc && doc.fields) || {}); });
      })
      .catch(function () { /* Offline for now: the form still works once the connection is back. */ });
  } else {
    loadTournament();
  }

  // Short links: everything about the tournament comes from its server document.
  function loadTournament() {
    show('loading');
    fetch(tournamentUrl(linkId) + '?key=' + encodeURIComponent(FIREBASE.apiKey))
      .then(function (response) {
        if (response.status === 404) { show('closed'); return; }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json().then(function (doc) {
          var fields = (doc && doc.fields) || {};
          p = payloadFrom(linkId, fields);
          if (!p) {
            // Published by an app version from before short links: it adds the details on its next check.
            $('broken-text').textContent = "This tournament isn't ready yet. Ask the organizer to open ScrimDesk, then open the link again.";
            show('broken');
            return;
          }
          fill();
          applyStatus(fields);
        });
      })
      .catch(function () { show('offline'); });
  }

  $('retry').addEventListener('click', loadTournament);

  $('copy').addEventListener('click', function () {
    function done() { $('copy-label').textContent = 'Copied'; setTimeout(function () { $('copy-label').textContent = 'Copy'; }, 2000); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(p.pn).then(done, function () {});
    }
  });

  // Players: name + UID rows, four at first, "Add player" up to six.
  function addPlayerRow() {
    var list = $('players');
    var n = list.children.length + 1;
    if (n > MAX_PLAYERS) return;
    var row = document.createElement('div');
    row.className = 'player';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Player ' + n);
    var name = document.createElement('input');
    name.type = 'text';
    name.className = 'player-name';
    name.maxLength = 24;
    name.autocomplete = 'off';
    name.placeholder = 'Player ' + n;
    name.setAttribute('aria-label', 'Player ' + n + ' in-game name');
    var uid = document.createElement('input');
    uid.type = 'text';
    uid.className = 'player-uid';
    uid.maxLength = 24;
    uid.autocomplete = 'off';
    uid.inputMode = 'numeric';
    uid.placeholder = 'UID';
    uid.setAttribute('aria-label', 'Player ' + n + ' UID');
    row.appendChild(name);
    row.appendChild(uid);
    list.appendChild(row);
    $('add-player').hidden = n >= MAX_PLAYERS;
    return name;
  }
  for (var r = 0; r < FIRST_ROWS; r++) addPlayerRow();
  $('add-player').addEventListener('click', function () {
    var input = addPlayerRow();
    if (input) input.focus();
  });

  function players() {
    return Array.prototype.map.call(document.querySelectorAll('.player'), function (row) {
      return {
        name: oneLine(row.querySelector('.player-name').value).slice(0, 24),
        uid: row.querySelector('.player-uid').value.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 24)
      };
    }).filter(function (pl) { return pl.name || pl.uid; }).slice(0, MAX_PLAYERS);
  }

  // Payment screenshot (required) and team logo (optional).
  var shot = null;
  var logo = null;

  $('shot').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    shot = file;
    var preview = $('preview');
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    $('drop-title').textContent = 'Change screenshot';
    $('drop').classList.add('has-image');
    setError('shot', '');
  });

  $('logo').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    logo = file;
    var preview = $('logo-preview');
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    $('logo-plus').hidden = true;
    $('logo-text').textContent = 'Logo added';
    $('logo-remove').hidden = false;
  });

  $('logo-remove').addEventListener('click', function () {
    logo = null;
    $('logo').value = '';
    $('logo-preview').hidden = true;
    $('logo-plus').hidden = false;
    $('logo-text').textContent = 'Square images look best.';
    this.hidden = true;
  });

  function setError(field, message) {
    $(field + '-error').textContent = message;
    var box = field === 'wa' ? $('wa-box') : field === 'shot' ? $('drop') : $(field);
    if (field === 'team' || field === 'person') box.setAttribute('aria-invalid', message ? 'true' : 'false');
    else if (box) box.classList.toggle('invalid', !!message);
  }

  ['team', 'person', 'wa'].forEach(function (id) {
    $(id).addEventListener('input', function () { setError(id, ''); });
  });

  var sending = false;

  $('form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (sending) return;
    var team = oneLine($('team').value).slice(0, 32);
    var tag = $('tag').value.replace(/\s+/g, '').slice(0, 6);
    var person = oneLine($('person').value).slice(0, 40);
    var phone = normalizePhone($('wa').value, dial);

    setError('team', team ? '' : 'Enter your team name');
    setError('person', person ? '' : 'Enter your name');
    setError('wa', !$('wa').value.trim() ? 'Enter your WhatsApp number' : phone ? '' : 'Enter a valid WhatsApp number');
    setError('shot', shot ? '' : 'Choose your payment screenshot');
    setError('send', '');
    if (!team) { $('team').focus(); return; }
    if (!person) { $('person').focus(); return; }
    if (!phone) { $('wa').focus(); return; }
    if (!shot) { $('shot').focus(); return; }

    sending = true;
    var button = $('send');
    button.disabled = true;
    button.classList.add('loading');
    $('send-label').textContent = 'Sending' + String.fromCharCode(0x2026);

    var shotData;
    compress(shot, [[1280, 0.75], [1080, 0.65], [900, 0.55], [720, 0.5]], SHOT_MAX_BYTES)
      .catch(function () { throw { field: 'shot', message: 'This screenshot can\'t be read. Choose another image.' }; })
      .then(function (blob) { return base64Of(blob); })
      .then(function (data) {
        shotData = data;
        if (!logo) return null;
        // An unreadable logo is left out rather than blocking the registration.
        return compress(logo, [[256, 0.8], [192, 0.7]], LOGO_MAX_BYTES).then(base64Of, function () { return null; });
      })
      .then(function (logoData) {
        var fields = registrationDocument({
          team: team, tag: tag, person: person, phone: phone, players: players(), shot: shotData, logo: logoData
        }).fields;
        var key = '?key=' + encodeURIComponent(FIREBASE.apiKey);
        function post(url, body) {
          return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .catch(function () {
              throw { field: 'send', message: "Couldn't send. Check your internet connection and try again." };
            });
        }
        var databaseUrl = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(FIREBASE.projectId) + '/databases/(default)/documents';
        return post(databaseUrl + ':commit' + key, commitBody(fields, newId())).then(function (response) {
          if (response.ok) {
            return response.json().then(function (result) {
              var writes = result && result.writeResults;
              var transforms = writes && writes[1] && writes[1].transformResults;
              var count = intValue(transforms && transforms[0]);
              if (count) {
                $('done-count').textContent = 'Your team is registration ' + count + ' of ' + p.tt + '.';
                $('done-count').hidden = false;
              }
              return { ok: true };
            }, function () { return { ok: true }; });
          }
          if (response.status !== 403) return response;
          // Refused: closed, or server rules from before the count. Saving without the count tells them apart.
          return post(documentsUrl() + '/registrations' + key, { fields: fields });
        });
      })
      .then(function (response) {
        if (response.ok) { show('done'); return; }
        // The rules refuse registrations for tournaments that are full, started or deleted.
        if (response.status === 403 || response.status === 404) { show('closed'); return; }
        throw { field: 'send', message: 'Something went wrong (' + response.status + '). Try again in a minute.' };
      })
      .catch(function (error) {
        var field = error && error.field ? error.field : 'send';
        setError(field, error && error.message ? error.message : 'Couldn\'t send. Try again.');
        if (field === 'shot') $('shot').focus();
      })
      .then(function () {
        sending = false;
        button.disabled = false;
        button.classList.remove('loading');
        $('send-label').textContent = 'Send registration';
      });
  });

  // ---- Country code sheet ----

  var sheet = $('cc-dialog');
  var focusAfterClose = null;

  function renderCountries(query) {
    var list = $('cc-list');
    var results = searchCountries(query);
    var fragment = document.createDocumentFragment();
    results.forEach(function (c) {
      var item = document.createElement('li');
      item.setAttribute('role', 'presentation');
      var option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(c === country));
      option.setAttribute('data-iso', c.iso);
      [['flag', flagOf(c.iso)], ['name', c.name], ['code', '+' + c.dial]].forEach(function (part) {
        var span = document.createElement('span');
        span.className = part[0];
        span.textContent = part[1];
        option.appendChild(span);
      });
      item.appendChild(option);
      fragment.appendChild(item);
    });
    list.textContent = '';
    list.appendChild(fragment);
    list.scrollTop = 0;
    $('cc-empty').hidden = results.length > 0;
  }

  function openCountries() {
    $('cc-search').value = '';
    renderCountries('');
    if (typeof sheet.showModal === 'function') sheet.showModal(); else sheet.setAttribute('open', '');
    // The selected country in the middle. Only the list scrolls (scrollIntoView would also move the page
    // behind the sheet), and the list may still be scrolled from the last time it was open.
    var list = $('cc-list');
    var selected = list.querySelector('[aria-selected="true"]');
    if (selected) {
      var offset = selected.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      list.scrollTop = offset - (list.clientHeight - selected.offsetHeight) / 2;
    }
    // On phones the keyboard would cover most of the list, so search only gets focus with a mouse.
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) $('cc-search').focus({ preventScroll: true });
  }

  function closeCountries() {
    if (typeof sheet.close === 'function') { sheet.close(); return; }
    sheet.removeAttribute('open');
    sheetClosed();
  }

  function sheetClosed() {
    (focusAfterClose || $('cc-button')).focus({ preventScroll: true });
    focusAfterClose = null;
  }

  $('cc-button').addEventListener('click', openCountries);
  $('cc-close').addEventListener('click', closeCountries);
  sheet.addEventListener('close', sheetClosed);
  // A tap on the dimmed backdrop closes the sheet.
  sheet.addEventListener('click', function (event) {
    if (event.target !== sheet) return;
    var r = sheet.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeCountries();
  });
  $('cc-search').addEventListener('input', function () { renderCountries(this.value); });
  $('cc-list').addEventListener('click', function (event) {
    var option = event.target.closest('button[data-iso]');
    if (!option) return;
    var iso = option.getAttribute('data-iso');
    var picked = COUNTRIES.filter(function (c) { return c.iso === iso; })[0];
    if (!picked) return;
    setCountry(picked);
    setError('wa', '');
    updateProgress();
    focusAfterClose = $('wa');
    closeCountries();
  });

  // A number typed or pasted with "+" switches the flag to that country.
  $('wa').addEventListener('input', function () {
    var value = this.value.trim();
    if (value.charAt(0) !== '+') return;
    var digits = digitsOf(value);
    for (var size = 4; size >= 1; size--) {
      if (digits.length <= size) continue;
      var found = countryForDial(digits.slice(0, size));
      if (found) {
        if (!country || country.dial !== found.dial) setCountry(found);
        return;
      }
    }
  });

  // ---- Step bar: a section gets its tick once its fields are filled; the one on screen is highlighted ----

  function updateProgress() {
    var state = {
      team: !!oneLine($('team').value),
      you: !!oneLine($('person').value) && !!normalizePhone($('wa').value, dial),
      players: players().length > 0,
      pay: !!shot
    };
    Object.keys(state).forEach(function (key) {
      var link = document.querySelector('.stepper [data-step="' + key + '"]');
      if (link) link.classList.toggle('done', state[key]);
      $('step-' + key).classList.toggle('complete', state[key]);
    });
    var required = [state.team, state.you, state.pay].filter(Boolean).length;
    $('progress').style.width = Math.round(required / 3 * 100) + '%';
  }
  $('form').addEventListener('input', updateProgress);
  $('form').addEventListener('change', updateProgress);
  updateProgress();

  var stepLinks = document.querySelectorAll('.stepper a');
  stepLinks[0].classList.add('current');
  Array.prototype.forEach.call(stepLinks, function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      var section = document.querySelector(link.getAttribute('href'));
      if (section) section.scrollIntoView({ block: 'start' });
    });
  });

  if ('IntersectionObserver' in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        Array.prototype.forEach.call(stepLinks, function (link) {
          link.classList.toggle('current', link.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    Array.prototype.forEach.call(document.querySelectorAll('.step'), function (step) { spy.observe(step); });
  }

  // ---- Sections fold up into place as they scroll in ----

  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !REDUCED) {
    var revealer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        revealer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -6% 0px' });
    Array.prototype.forEach.call(reveals, function (el) { revealer.observe(el); });
  } else {
    Array.prototype.forEach.call(reveals, function (el) { el.classList.add('in'); });
  }

  // ---- The ticket tilts in 3D: with the mouse on computers, with the phone itself on Android ----

  (function tilt(el) {
    if (REDUCED || !el) return;
    var target = { x: 0, y: 0 };
    var now = { x: 0, y: 0 };
    var frame = 0;
    function draw() {
      now.x += (target.x - now.x) * 0.1;
      now.y += (target.y - now.y) * 0.1;
      el.style.setProperty('--rx', now.x.toFixed(2) + 'deg');
      el.style.setProperty('--ry', now.y.toFixed(2) + 'deg');
      el.style.setProperty('--mx', (50 + now.y * 6).toFixed(1) + '%');
      el.style.setProperty('--my', (20 - now.x * 6).toFixed(1) + '%');
      var settled = Math.abs(target.x - now.x) < 0.02 && Math.abs(target.y - now.y) < 0.02;
      frame = settled ? 0 : requestAnimationFrame(draw);
    }
    function aim(x, y) {
      target.x = Math.max(-9, Math.min(9, x));
      target.y = Math.max(-9, Math.min(9, y));
      if (!frame) frame = requestAnimationFrame(draw);
    }
    el.addEventListener('pointermove', function (event) {
      if (event.pointerType !== 'mouse') return;
      var r = el.getBoundingClientRect();
      aim(((event.clientY - r.top) / r.height - 0.5) * -14, ((event.clientX - r.left) / r.width - 0.5) * 16);
    });
    el.addEventListener('pointerleave', function () { aim(0, 0); });
    // Relative to how the phone is held; slowly settles back when it's held still at a new angle.
    var rest = null;
    window.addEventListener('deviceorientation', function (event) {
      if (event.beta === null || event.gamma === null) return;
      if (!rest) rest = { beta: event.beta, gamma: event.gamma };
      rest.beta += (event.beta - rest.beta) * 0.02;
      rest.gamma += (event.gamma - rest.gamma) * 0.02;
      aim((event.beta - rest.beta) / 2.5, (event.gamma - rest.gamma) / 2.5);
    });
  })($('ticket'));

  // ---- Background shapes drift at different depths while scrolling ----

  if (!REDUCED) {
    var floats = Array.prototype.slice.call(document.querySelectorAll('.float'));
    var scheduled = false;
    window.addEventListener('scroll', function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        var y = window.scrollY;
        floats.forEach(function (f) {
          f.style.transform = 'translate3d(0,' + (-y * Number(f.getAttribute('data-depth') || 0)).toFixed(1) + 'px,0)';
        });
        scheduled = false;
      });
    }, { passive: true });
  }
})();

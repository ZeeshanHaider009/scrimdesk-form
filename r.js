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
    ['broken', 'closed', 'register', 'done'].forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
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

  // ---- Formatting (same rules as the app's Money and date labels) ----

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

  function when(millis) {
    var d = new Date(millis);
    var day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return day + ' \u00B7 ' + time;
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

  function documentsUrl() {
    return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(FIREBASE.projectId) +
      '/databases/(default)/documents/tournaments/' + encodeURIComponent(p.i);
  }

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
    $('teams').textContent = count + ' / ' + p.tt;
    $('teams-label').textContent = 'Registered';
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

  // ---- Page ----

  var p = readPayload();
  if (!p) {
    show('broken');
    return;
  }
  if (!p.i) {
    $('broken-text').textContent = 'This link is from an older version of ScrimDesk. Ask the organizer to share the tournament again.';
    show('broken');
    return;
  }
  if (!FIREBASE.projectId || !FIREBASE.apiKey) {
    $('closed-text').textContent = 'Online registration isn\'t set up yet. Ask the organizer how to register.';
    show('closed');
    return;
  }

  var dial = /^\d{1,4}$/.test(p.dc || '') ? p.dc : (LEGACY_DIAL[p.cur] || '');
  document.title = p.n + ' \u00B7 Registration';
  $('game').textContent = GAMES[p.g] || 'Tournament';
  $('name').textContent = p.n;
  $('when').textContent = when(p.t);
  // Tournaments made after the app dropped the prize step carry no prize or fee: the poster shows them.
  $('prize').textContent = p.p ? money(p.p, p.cur) : '';
  $('prize-fact').hidden = !p.p;
  $('fee').textContent = p.f > 0 ? money(p.f, p.cur) : '';
  $('fee-fact').hidden = !(p.f > 0);
  $('teams').textContent = String(p.tt);
  $('dial').textContent = '+' + dial;
  $('wa').placeholder = STRICT[dial] ? STRICT[dial].hint : (dial ? 'Phone number' : 'With country code');
  $('method').textContent = (METHODS[p.pm] || 'Payment') + (p.f > 0 ? ' \u00B7 ' + money(p.f, p.cur) : '');
  $('number').textContent = p.pn || '\u2013';
  $('pay-info').hidden = !p.pn;
  show('register');

  // Already closed (full, started or deleted)? Say so before anyone fills in the form.
  fetch(documentsUrl() + '?key=' + encodeURIComponent(FIREBASE.apiKey))
    .then(function (response) {
      if (response.status === 404) return { closed: true };
      if (!response.ok) return null;
      return response.json().then(function (doc) {
        var fields = (doc && doc.fields) || {};
        showRegistered(intValue(fields.registered) || 0);
        return { closed: !(fields.open && fields.open.booleanValue === true) };
      });
    })
    .then(function (result) { if (result && result.closed) show('closed'); })
    .catch(function () { /* Offline for now: the form still works once the connection is back. */ });

  $('copy').addEventListener('click', function () {
    var button = this;
    function done() { button.textContent = 'Copied'; setTimeout(function () { button.textContent = 'Copy'; }, 2000); }
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
    $('drop-text').innerHTML = '<b>Change screenshot</b>';
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
    button.textContent = 'Sending\u2026';

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
        button.textContent = 'Send registration';
      });
  });
})();

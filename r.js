// ScrimDesk player registration form. Runs only in the player's browser: nothing is uploaded.
// Reads the tournament from ?d= (base64url JSON written by the app's FormLink) and builds the
// SCRIMDESK block that the app's RegistrationParser reads. Keep both in sync.
(function () {
  'use strict';

  var COUNTRY = {
    PKR: { dial: '92', symbol: 'Rs', indian: false, mobile: /^3\d{9}$/, hint: '300 1234567' },
    INR: { dial: '91', symbol: '\u20B9', indian: true, mobile: /^[6-9]\d{9}$/, hint: '98765 43210' },
    BDT: { dial: '880', symbol: '\u09F3', indian: true, mobile: /^1[3-9]\d{8}$/, hint: '1712 345678' },
    NPR: { dial: '977', symbol: 'Rs', indian: true, mobile: /^9[6-8]\d{8}$/, hint: '984 1234567' }
  };
  var GAMES = { FREE_FIRE: 'Free Fire', PUBG_MOBILE: 'PUBG Mobile', BGMI: 'BGMI', COD_MOBILE: 'COD Mobile' };
  var METHODS = { JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa', UPI: 'UPI', BKASH: 'bKash', ESEWA: 'eSewa', BANK: 'Bank transfer' };
  var HEADER = '----- SCRIMDESK -----';
  var FOOTER = '---------------------';

  function $(id) { return document.getElementById(id); }
  function show(id) {
    ['broken', 'register', 'attach', 'done'].forEach(function (s) { $(s).hidden = s !== id; });
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
        COUNTRY[p.cur] && typeof p.wa === 'string' && /^\+\d{8,15}$/.test(p.wa) && typeof p.pn === 'string';
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
    var c = COUNTRY[cur];
    var grouped = group(amount, c.indian);
    return c.symbol.length > 1 ? c.symbol + ' ' + grouped : c.symbol + grouped;
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

  function fromInternational(digits) {
    var codes = Object.keys(COUNTRY).sort(function (a, b) { return COUNTRY[b].dial.length - COUNTRY[a].dial.length; });
    for (var i = 0; i < codes.length; i++) {
      var c = COUNTRY[codes[i]];
      if (digits.indexOf(c.dial) === 0 && c.mobile.test(digits.slice(c.dial.length))) return '+' + digits;
    }
    return null;
  }

  function normalizePhone(input, cur) {
    var trimmed = input.trim();
    var digits = digitsOf(trimmed);
    if (!digits) return null;
    if (trimmed.charAt(0) === '+') return fromInternational(digits);
    if (digits.indexOf('00') === 0) return fromInternational(digits.slice(2));
    var national = digits.replace(/^0/, '');
    if (COUNTRY[cur].mobile.test(national)) return '+' + COUNTRY[cur].dial + national;
    return fromInternational(digits);
  }

  // ---- The registration block ----

  function oneLine(text) {
    return text.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function buildBlock(p, team, phone, captain, uids) {
    var lines = [HEADER, 'Code: ' + p.c, 'Team: ' + team, 'WhatsApp: ' + phone];
    if (captain) lines.push('Captain: ' + captain);
    if (uids.length) lines.push('UIDs: ' + uids.slice(0, 4).join(', '));
    lines.push(FOOTER);
    return lines.join('\n');
  }

  function whatsappLink(p, text) {
    return 'https://wa.me/' + p.wa.replace(/\D/g, '') + '?text=' + encodeURIComponent(text);
  }

  // ---- Page ----

  var p = readPayload();
  if (!p) {
    show('broken');
    return;
  }

  var country = COUNTRY[p.cur];
  document.title = p.n + ' \u00B7 Registration';
  $('game').textContent = GAMES[p.g] || 'Tournament';
  $('name').textContent = p.n;
  $('when').textContent = when(p.t);
  $('prize').textContent = p.p ? money(p.p, p.cur) : '\u2013';
  $('fee').textContent = p.f > 0 ? money(p.f, p.cur) : 'Free';
  $('teams').textContent = String(p.tt);
  $('dial').textContent = '+' + country.dial;
  $('wa').placeholder = country.hint;
  $('method').textContent = (METHODS[p.pm] || 'Payment') + (p.f > 0 ? ' \u00B7 ' + money(p.f, p.cur) : '');
  $('number').textContent = p.pn || '\u2013';
  $('copy').hidden = !p.pn;
  show('register');

  $('copy').addEventListener('click', function () {
    var button = this;
    function done() { button.textContent = 'Copied'; setTimeout(function () { button.textContent = 'Copy'; }, 2000); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(p.pn).then(done, function () {});
    }
  });

  var shot = null;
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

  function setError(field, message) {
    $(field + '-error').textContent = message;
    var box = field === 'wa' ? $('wa-box') : field === 'shot' ? $('drop') : $(field);
    if (field === 'team') box.setAttribute('aria-invalid', message ? 'true' : 'false');
    else box.classList.toggle('invalid', !!message);
  }

  ['team', 'wa'].forEach(function (id) {
    $(id).addEventListener('input', function () { setError(id, ''); });
  });

  var lastMessage = '';

  $('form').addEventListener('submit', function (event) {
    event.preventDefault();
    var team = oneLine($('team').value).slice(0, 32);
    var phone = normalizePhone($('wa').value, p.cur);
    var captain = oneLine($('captain').value).slice(0, 40);
    var uids = Array.prototype.map.call(document.querySelectorAll('.uid'), function (input) {
      return input.value.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 24);
    }).filter(Boolean);

    setError('team', team ? '' : 'Enter your team name');
    setError('wa', !$('wa').value.trim() ? 'Enter the captain\'s WhatsApp number' : phone ? '' : 'Enter a valid WhatsApp number');
    setError('shot', shot ? '' : 'Choose your payment screenshot');
    if (!team) { $('team').focus(); return; }
    if (!phone) { $('wa').focus(); return; }
    if (!shot) { $('shot').focus(); return; }

    lastMessage = buildBlock(p, team, phone, captain, uids);
    send(lastMessage);
  });

  function send(text) {
    var files = [shot];
    if (navigator.canShare && navigator.share && navigator.canShare({ files: files })) {
      navigator.share({ files: files, text: text }).then(function () {
        show('done');
      }, function (error) {
        // Closing the share sheet keeps the form; anything else falls back to wa.me.
        if (!error || error.name !== 'AbortError') openWhatsApp(text);
      });
    } else {
      openWhatsApp(text);
    }
  }

  function openWhatsApp(text) {
    var link = whatsappLink(p, text);
    $('open-again').href = link;
    show('attach');
    window.location.href = link;
  }

  $('sent-both').addEventListener('click', function () { show('done'); });
  $('retry').addEventListener('click', function (event) {
    event.preventDefault();
    if (!lastMessage) return;
    this.href = whatsappLink(p, lastMessage);
    window.location.href = this.href;
  });
})();

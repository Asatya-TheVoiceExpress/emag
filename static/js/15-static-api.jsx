/* emag_shim.jsx -- static-build API shim for The Voice Express.
   Copied verbatim by ve-push.py into emag/static/js/15-static-api.jsx, loaded
   right after 10-core.jsx (which defines the global `API` object) and before
   every other page/view script. It monkey-patches API.get/post/put/del so the
   *same* reader-facing JSX used by the live site works unmodified against a
   frozen JSON export instead of the Flask API.

   Data source: ./data/*.json (written by ve-push.py) and, for comments/likes/
   letter-submissions/subscribe, the Apps Script deployment named in
   ./data/config.json's "api" field (same one the Newsstand --
   voiceexpressstand/ -- already uses), called via JSONP exactly like
   voiceexpressstand/app.js does (see tools/stand_apps_script.gs).

   ./data/letters.json is written by ve-push.py itself (dump_letters(), read
   straight from voice_express.db's source='sheet' letters), but the letters
   in it only exist in the DB once site_data_get.py (repo root) has pulled
   them out of the Sheet first -- so the round trip is: reader submits here
   via jsonp (letters_add) -> site_data_get.py imports approved rows into
   voice_express.db (and editors can reply from app.py's Mailbox) -> next
   ve-push.py run re-reads the DB and refreshes this file, replies included.
   A submission only shows up on this page after both steps have run.

   Ebook requests (PublicEbookRequestPage, case 'ebook') follow the same
   shape: this build can't generate an ePub itself, so a submission (jsonp
   ebook_request_add) just queues the article picks + metadata in the Sheet.
   site_data_get.py builds the actual file using app.py's own build_epub()/
   _save_to_library() and inserts it straight into the publications table --
   the next ve-push.py picks it up in publications.json like any other
   ebook, no different from one generated live on the server.

   Do not hand-edit emag/static/js/15-static-api.jsx -- edit this file and
   rerun ve-push.py. */
/* FormField is normally defined in 50-editor.jsx (excluded from this build),
   but CommentsSection (80-rest.jsx) and LoginModal (10-core.jsx) -- both
   reader-facing -- use it too. Keep it available by defining it here, since
   this file loads right after 10-core.jsx and before everything else. */
function FormField({label,children}){
  return <div className="form-g"><label className="form-lbl">{label}</label>{children}</div>;
}

(function(){

var STORE = {ready:null, articles:[], categories:[], sections:[], tags:[],
  authors:[], series:[], newsletters:{months:[],issues:[]}, columns:[],
  pages:{}, publications:[], crosswords:{}, config:{api:''}, letters:[], readerState:{}};

function fetchJSON(path){
  return fetch(path).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
    .catch(function(){ return null; });
}

STORE.ready = Promise.all([
  fetchJSON('./data/articles.json').then(function(d){ STORE.articles = d||[]; }),
  fetchJSON('./data/categories.json').then(function(d){ STORE.categories = d||[]; }),
  fetchJSON('./data/sections.json').then(function(d){ STORE.sections = d||[]; }),
  fetchJSON('./data/tags.json').then(function(d){ STORE.tags = d||[]; }),
  fetchJSON('./data/authors.json').then(function(d){ STORE.authors = d||[]; }),
  fetchJSON('./data/series.json').then(function(d){ STORE.series = d||[]; }),
  fetchJSON('./data/newsletters.json').then(function(d){ STORE.newsletters = d||{months:[],issues:[]}; }),
  fetchJSON('./data/columns.json').then(function(d){ STORE.columns = d||[]; }),
  fetchJSON('./data/pages.json').then(function(d){ STORE.pages = d||{}; }),
  fetchJSON('./data/publications.json').then(function(d){ STORE.publications = d||[]; }),
  fetchJSON('./data/link-previews.json').then(function(d){ STORE.linkPreviews = d||{}; }),
  fetchJSON('./data/puzzles/crossword-words.json').then(function(d){ STORE.crosswords = d||{}; }),
  fetchJSON('./data/config.json').then(function(d){ STORE.config = d||{api:''}; }),
  // written by site_data_get.py, not ve-push.py -- letters approved & imported
  // from the Apps Script Sheet into voice_express.db, frozen as of its last run
  fetchJSON('./data/letters.json').then(function(d){ STORE.letters = d||[]; }),
  // written by ve-push.py's dump_reader_state() -- what happened to each
  // signed-in reader's comments/letters/ebook requests, keyed by lowercased
  // username. See that function's PRIVACY note: this file is public, so it
  // carries only already-public outcomes, never an email.
  fetchJSON('./data/reader_state.json').then(function(d){ STORE.readerState = d||{}; }),
]);

/* ── JSONP to the Apps Script (same convention as voiceexpressstand/app.js) ── */
function jsonp(params){
  return new Promise(function(res,rej){
    var api = STORE.config.api;
    if(!api){ rej('noapi'); return; }
    var cb = 've_cb_'+Math.random().toString(36).slice(2);
    var s = document.createElement('script');
    var to = setTimeout(function(){ cleanup(); rej('timeout'); }, 12000);
    function cleanup(){ clearTimeout(to); try{ delete window[cb]; }catch(e){} s.remove(); }
    window[cb] = function(d){ cleanup(); res(d); };
    params.callback = cb;
    s.src = api + (api.indexOf('?')>-1?'&':'?') + new URLSearchParams(params).toString();
    s.onerror = function(){ cleanup(); rej('neterr'); };
    document.head.appendChild(s);
  });
}

/* ── passwordless accounts, shared with the Stand ────────────────────────────
   The same 'Users' sheet and the same signup/login actions voiceexpressstand/
   app.js uses, so one handle works on both mirrors. localStorage is per-origin,
   so a reader signs in separately on each domain -- the ACCOUNT is shared, the
   session is not.

   No password by design (it is a handle, not a credential). Nothing gated on
   it is private: it decides which already-public outcomes to surface, never
   what a reader is allowed to see. Do not put anything sensitive behind it. */
var VE_USER_KEY = 've_user';
function veUser(){ try{ return localStorage.getItem(VE_USER_KEY)||''; }catch(e){ return ''; } }
function veSetUser(u){
  try{ u ? localStorage.setItem(VE_USER_KEY,u) : localStorage.removeItem(VE_USER_KEY); }catch(e){}
  window.dispatchEvent(new CustomEvent('ve-user-changed',{detail:u||''}));
}
function veAccount(mode, username){
  return jsonp({action: mode==='up'?'signup':'login', username:username});
}
/** Everything the build knows about this reader's own submissions. */
function veReaderState(username){
  var u = (username||veUser()||'').trim().toLowerCase();
  var s = u && STORE.readerState ? STORE.readerState[u] : null;
  return s || {comments:[], letters:[], ebooks:[]};
}
window.veUser = veUser; window.veSetUser = veSetUser;
window.veAccount = veAccount; window.veReaderState = veReaderState;

/* ── localStorage-backed puzzle progress ── */
var LS_KEY = 've-puzzle-sessions';
function lsSessions(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'{}'); }catch(e){ return {}; } }
function lsSaveSessions(s){ try{ localStorage.setItem(LS_KEY, JSON.stringify(s)); }catch(e){} }
function sessionKey(type,date,difficulty){ return type+'|'+date+'|'+(difficulty||''); }

function dayOfYear(ds){ var d=new Date(ds+'T12:00:00'); return Math.floor((d-new Date(d.getFullYear(),0,0))/864e5); }

/* ── query-string helpers ── */
function qs(url){ var i=url.indexOf('?'); var p={}; if(i<0) return p;
  new URLSearchParams(url.slice(i+1)).forEach(function(v,k){ p[k]=v; }); return p; }
function path(url){ var i=url.indexOf('?'); return i<0?url:url.slice(0,i); }

function articleMatches(a,p,idx){
  if(p.status && p.status!=='all' && a.status!==p.status) return false;
  if(p.category && a.category_slug!==p.category && a.category_name!==p.category) return false;
  if(p.section && a.section_slug!==p.section && a.section_name!==p.section) return false;
  if(p.author_id && String(a.author_id)!==String(p.author_id)) return false;
  if(p.language && a.language!==p.language) return false;
  if(p.geotagged==='true' && !(a.latitude && a.latitude!==0)) return false;
  if(p.featured==='true' && !a.is_featured) return false;
  if(p.tag){
    var tags=a.tags||[];
    if(!tags.some(function(t){ return t.slug===p.tag || t.name===p.tag; })) return false;
  }
  if(p.title_search){
    var q=p.title_search.toLowerCase();
    if((a.title||'').toLowerCase().indexOf(q)<0) return false;
  } else if(p.search){
    var q2=p.search.toLowerCase();
    /* `content` is no longer in the listing payload (see getArticle). `idx` is
       the lazily-fetched plain-text index; if it has not loaded, the match
       degrades to title/excerpt/author rather than silently finding nothing. */
    var body = (idx && idx[String(a.id)]) || '';
    var hay=[a.title,a.excerpt,a.author_name,body].join(' ').toLowerCase();
    if(hay.indexOf(q2)<0) return false;
  }
  return true;
}

function listArticles(p){
  var offset = parseInt(p.offset||'0',10)||0;
  var limit  = Math.min(parseInt(p.limit||'50',10)||50, 200);
  var page = function(idx){
    var out = STORE.articles.filter(function(a){ return articleMatches(a,p,idx); });
    return out.slice(offset, offset+limit);
  };
  /* only a real full-text search pays for the index download */
  if(p.search && !p.title_search) return ensureSearchIndex().then(page);
  return page(null);
}

/* ── article detail, fetched on demand ──────────────────────────────────────
   articles.json ships WITHOUT `content` (see ve-push.py): bodies were 455 KB
   of a 734 KB file downloaded before first paint, and no listing view renders
   them. The reader view needs the full record, so pull ./data/articles/<id>.json
   the first time it is asked for and merge it into the loaded list, so a second
   visit to the same piece costs nothing. */
var _detail = {};   /* id -> Promise<article> */

function findArticleLite(id){
  return STORE.articles.find(function(a){ return String(a.id)===String(id); }) || null;
}

/* ── read logging ────────────────────────────────────────────────────────────
   The Stand has logged reads/downloads/pay-taps to the Activity sheet since day
   one (voiceexpressstand/app.js's logEvent). The emag never logged anything, so
   every traffic figure in the newsroom covered the Newsstand only and the
   magazine -- the busier of the two -- was invisible.

   Same `log` action and the same column shape, so both mirrors land in one
   ledger. Deliberately fire-and-forget and deduped per session: this must never
   delay or break opening an article, and a reader flipping back to a piece
   three times in one sitting is one read, not three. No IP lookup either --
   the Stand fetches one from ipify; that is a third-party call on every read
   and the field is optional. */
var _logged = {};
function logRead(id){
  if(_logged[id]) return; _logged[id] = 1;
  try{
    var a = findArticleLite(id) || {};
    jsonp({action:'log', kind:'read', t:new Date().toISOString(),
      title:(a.title||''), file:'', type:'article', amount:0,
      currency:(STORE.config&&STORE.config.currency)||'', via:'emag',
      user:veUser(), ip:'', ref:location.href}).catch(function(){});
  }catch(e){}
}

function getArticle(id){
  var lite = findArticleLite(id);
  /* already whole (older build, or previously fetched) */
  if(lite && typeof lite.content === 'string') return Promise.resolve(lite);
  if(!_detail[id]){
    _detail[id] = fetchJSON('./data/articles/' + encodeURIComponent(id) + '.json')
      .then(function(full){
        if(!full) return lite;                    /* fall back to what we have */
        var i = STORE.articles.findIndex(function(a){ return String(a.id)===String(id); });
        if(i >= 0) STORE.articles[i] = Object.assign({}, STORE.articles[i], full);
        else STORE.articles.push(full);
        return STORE.articles[i >= 0 ? i : STORE.articles.length - 1];
      });
  }
  return _detail[id];
}

/* Full-text search index -- only ever fetched if the reader actually searches,
   so browsing costs nothing for a feature most visits never touch. */
var _searchIdx = null;
function ensureSearchIndex(){
  if(_searchIdx) return _searchIdx;
  _searchIdx = fetchJSON('./data/search-index.json').then(function(d){ return d || {}; });
  return _searchIdx;
}

/* ── main GET router ── */
function routeGet(url){
  return STORE.ready.then(function(){
    var p2 = path(url), params = qs(url), m;

    if(p2==='/api/articles') return listArticles(params);

    if((m=p2.match(/^\/api\/articles\/(\d+)$/))){ logRead(m[1]); return getArticle(m[1]); }

    if((m=p2.match(/^\/api\/articles\/(\d+)\/comments$/))){
      return jsonp({action:'comments_get', article_id:m[1]}).catch(function(){ return []; });
    }
    if((m=p2.match(/^\/api\/articles\/(\d+)\/likes$/))){
      return jsonp({action:'like_count', article_id:m[1]}).catch(function(){ return {count:0}; });
    }
    if((m=p2.match(/^\/api\/articles\/(\d+)\/translations$/))){
      return getArticle(m[1]).then(function(a){ return (a&&a.translations)||[]; });
    }
    if((m=p2.match(/^\/api\/articles\/(\d+)\/translation\/([a-z-]+)$/))){
      return getArticle(m[1]).then(function(a2){
        var t=((a2&&a2.translations)||[]).find(function(x){return x.language===m[2];});
        return t||{error:'not found'};
      });
    }
    if((m=p2.match(/^\/api\/articles\/(\d+)\/corrections$/))){
      return getArticle(m[1]).then(function(a3){ return (a3&&a3.corrections)||[]; });
    }

    if(p2==='/api/categories') return STORE.categories;
    if(p2==='/api/sections')   return STORE.sections;
    if(p2==='/api/tags')       return STORE.tags;
    if(p2==='/api/authors')    return STORE.authors;
    if((m=p2.match(/^\/api\/authors\/(\d+)\/links$/))){
      var au=STORE.authors.find(function(x){return String(x.id)===m[1];}); return (au&&au.links)||[];
    }
    if((m=p2.match(/^\/api\/authors\/(\d+)\/contributions$/))){
      var au2=STORE.authors.find(function(x){return String(x.id)===m[1];}); return (au2&&au2.contributions)||[];
    }
    if(p2==='/api/series') return STORE.series;
    if((m=p2.match(/^\/api\/series\/(\d+)$/))){
      return STORE.series.find(function(s){return String(s.id)===m[1];})||{error:'not found'};
    }

    if(p2==='/api/newsletters/months') return STORE.newsletters.months;
    if(p2==='/api/newsletters/current'){
      var now=new Date();
      return STORE.newsletters.issues.find(function(i){return i.year===now.getFullYear()&&i.month===now.getMonth()+1;})
        || STORE.newsletters.issues[0] || null;
    }
    if(p2==='/api/newsletters/range'){
      var yms = STORE.newsletters.months.map(function(x){return x.year+'-'+String(x.month).padStart(2,'0');});
      return {min: yms.length?yms[yms.length-1]:'', max: yms.length?yms[0]:''};
    }
    if((m=p2.match(/^\/api\/newsletters\/(\d+)\/(\d+)$/))){
      var y=+m[1], mo=+m[2];
      return STORE.newsletters.issues.find(function(i){return i.year===y&&i.month===mo;}) || {error:'not found'};
    }

    if(p2==='/api/columns') return STORE.columns;
    if((m=p2.match(/^\/api\/columns\/([^/]+)$/))){
      return STORE.columns.find(function(c){return c.slug===m[1]||String(c.id)===m[1];}) || {error:'not found'};
    }
    if((m=p2.match(/^\/api\/column-entries\/(\d+)$/))){
      for(var i=0;i<STORE.columns.length;i++){
        var e=(STORE.columns[i].entries||[]).find(function(x){return String(x.id)===m[1];});
        if(e) return e;
      }
      return {error:'not found'};
    }

    if((m=p2.match(/^\/api\/pages\/([^/]+)$/))) return STORE.pages[m[1]] || {error:'not found'};
    if(p2==='/api/pages') return Object.values(STORE.pages);

    if(p2==='/api/publications') return {publications: STORE.publications};
    if((m=p2.match(/^\/api\/publications\/(\d+)$/))){
      return STORE.publications.find(function(x){return String(x.id)===m[1];}) || {error:'not found'};
    }

    if(p2==='/api/puzzles/wordcache'){
      var doy = params.date ? dayOfYear(params.date) : 0;
      var topics = Object.keys(STORE.crosswords);
      var key = topics.length ? String(doy % topics.length) : null;
      return key!==null ? STORE.crosswords[key] : null;
    }
    if(p2==='/api/puzzles/session'){
      var sess = lsSessions();
      var s = sess[sessionKey(params.type,params.date,params.difficulty)];
      return s || null;
    }
    if(p2==='/api/puzzles/archive'){
      var sess2 = lsSessions(), out=[];
      Object.keys(sess2).forEach(function(k){
        var parts=k.split('|');
        if(parts[0]===params.type && (params.difficulty||'')===parts[2]){
          out.push({puzzle_date:parts[1], difficulty:parts[2], elapsed:sess2[k].elapsed||0, completed:!!sess2[k].completed});
        }
      });
      out.sort(function(a,b){ return a.puzzle_date<b.puzzle_date?1:-1; });
      return out.slice(0,60);
    }

    if(p2==='/api/link-preview'){
      return STORE.linkPreviews[params.url] || {url:params.url, site:'', title:'', description:'', image:''};
    }

    // Public letters-to-the-editor -- frozen list from the last site_data_get.py
    // run (submissions go live via jsonp in routePost below, not straight here)
    if(p2==='/api/letters') return STORE.letters;

    if(p2==='/api/auth/me') return null;   /* no accounts in this build */

    return {error:'not available in the static build'};
  });
}

/* ── auto-translate via MyMemory: free, no API key, CORS-enabled for browser
   use (unlike the LibreTranslate public instance, which requires a paid key
   and doesn't set CORS headers) -- good enough for a static, backend-less build */
var LANG_MM_CODE = {en:'en',hi:'hi',fr:'fr',es:'es',ar:'ar',zh:'zh-CN',de:'de'};
function mmChunks(text){
  var LIMIT=450;
  if(encodeURIComponent(text).length<LIMIT) return [text];
  var parts=text.match(/[^.!?\n]+[.!?\n]*\s*/g)||[text];
  var chunks=[], cur='';
  parts.forEach(function(p){
    if(encodeURIComponent(cur+p).length>LIMIT){ if(cur)chunks.push(cur); cur=p; }
    else cur+=p;
  });
  if(cur) chunks.push(cur);
  return chunks;
}
function mmCall(text, source, target){
  if(!text||!text.trim()) return Promise.resolve(text);
  var url='https://api.mymemory.translated.net/get?q='+encodeURIComponent(text)+'&langpair='+source+'|'+target;
  return fetch(url).then(function(r){return r.json();}).then(function(d){
    if(d && d.responseData && d.responseData.translatedText) return d.responseData.translatedText;
    throw new Error((d&&d.responseDetails)||'translate failed');
  });
}
function mmTranslateText(text, source, target){
  if(!text||!text.trim()) return Promise.resolve(text);
  var chunks=mmChunks(text);
  return Promise.all(chunks.map(function(c){return mmCall(c,source,target);})).then(function(res){return res.join('');});
}
function mmTranslateHTML(html, source, target){
  if(!html) return Promise.resolve(html);
  var wrap=document.createElement('div'); wrap.innerHTML=html;
  var walker=document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
  var nodes=[], n;
  while((n=walker.nextNode())) if(n.nodeValue && n.nodeValue.trim()) nodes.push(n);
  return nodes.reduce(function(p,node){
    return p.then(function(){
      return mmTranslateText(node.nodeValue, source, target).then(function(t){ node.nodeValue=t; });
    });
  }, Promise.resolve()).then(function(){ return wrap.innerHTML; });
}

/* ── main POST router ── */
function routePost(url, data){
  var p2 = path(url), m;
  if((m=p2.match(/^\/api\/articles\/(\d+)\/comments$/))){
    return jsonp({action:'comments_add', article_id:m[1], username:veUser(),
      display_name:(data&&data.display_name)||'', content:(data&&data.content)||''}).catch(function(){
        return {error:'Could not reach the comment service. Try again.'};
      });
  }
  if((m=p2.match(/^\/api\/articles\/(\d+)\/like$/))){
    return jsonp({action:'like_add', article_id:m[1]}).catch(function(){
      return {error:'Could not reach the like service. Try again.'};
    });
  }
  if(p2==='/api/letters'){
    return jsonp({action:'letters_add', username:veUser(),
      name:(data&&(data.guest_name||data.name))||'', subject:(data&&data.subject)||'', content:(data&&data.content)||''}).then(function(r){
        if(r&&r.error) return r;
        return {success:true};
      }).catch(function(){
        return {error:'Could not reach the letters service. Try again.'};
      });
  }
  if(p2==='/api/subscribe'){
    return jsonp({action:'subscribe', email:(data&&data.email)||''}).catch(function(){
      return {error:'Could not reach the subscribe service. Try again.'};
    });
  }
  if(p2==='/api/ebook-requests'){
    // emag can't generate an ePub itself -- this hands the article picks +
    // metadata to the Sheet; site_data_get.py builds the actual file with
    // app.py's own build_epub()/_save_to_library() and it shows up in the
    // Newsstand on the next ve-push.py run.
    return jsonp({action:'ebook_request_add', username:veUser(),
      name:(data&&data.name)||'', email:(data&&data.email)||'',
      title:(data&&data.title)||'', creator:(data&&data.creator)||'',
      description:(data&&data.description)||'', article_ids:(data&&data.article_ids)||''}).then(function(r){
        if(r&&r.error) return r;
        return {success:true};
      }).catch(function(){
        return {error:'Could not reach the ebook request service. Try again.'};
      });
  }
  if(p2==='/api/annotations'){
    // fire-and-forget backup log -- the visible copy lives in localStorage
    // (see 30-read.jsx saveAnn), this just means it's not lost if the
    // browser's storage is cleared. No response is read by the caller.
    return jsonp({action:'annotation_add', article_id:(data&&data.article_id)||'',
      selected_text:(data&&data.selected_text)||'', note:(data&&data.note)||''}).catch(function(){ return {ok:false}; });
  }
  if(p2==='/api/puzzles/session'){
    var sess = lsSessions();
    sess[sessionKey(data.type,data.date,data.difficulty)] = {state:data.state, elapsed:data.elapsed, completed:data.completed};
    lsSaveSessions(sess);
    return Promise.resolve({ok:true});
  }
  if(p2==='/api/reader/puzzle-complete'){
    var sess2 = lsSessions();
    var k = sessionKey(data.type,data.date,data.difficulty);
    sess2[k] = Object.assign({}, sess2[k], {completed:true, elapsed:data.elapsed});
    lsSaveSessions(sess2);
    return Promise.resolve({ok:true});
  }
  if(p2==='/api/puzzles/wordcache'){
    return Promise.resolve({ok:true});   /* pre-baked; nothing to persist */
  }
  if(p2==='/api/translate'){
    /* needs the BODY, so it goes through getArticle rather than the lite list */
    return getArticle(data.article_id).then(function(art){
      if(!art) return {error:'Article not found'};
      var native = art.language||'en';
      var target = data.target_language;
      if(!target||target===native) return {error:'Invalid target language'};
      /* a hand-written translation baked into the export always wins over machine translation */
      var existing = ((art.translations)||[]).find(function(x){return x.language===target;});
      if(existing) return existing;
      var srcMM = LANG_MM_CODE[native]||native, tgtMM = LANG_MM_CODE[target]||target;
      return Promise.all([
        mmTranslateText(art.title||'', srcMM, tgtMM),
        mmTranslateText(art.excerpt||'', srcMM, tgtMM),
        mmTranslateHTML(art.content||'', srcMM, tgtMM)
      ]).then(function(r){
        return {title:r[0], excerpt:r[1], content:r[2], language:target};
      }).catch(function(){
        return {error:'Translation service unavailable. Please try again.'};
      });
    });
  }
  return Promise.resolve({error:'not available in the static build'});
}

/* `API` is a `const` declared by 10-core.jsx -- shares this document's global
   lexical scope (classic scripts, sibling <script>/<script type="text/babel">
   tags all see the same top-level let/const bindings), so this file must load
   AFTER 10-core.jsx and stay type="text/babel" like it, not become a plain
   script (that would run at HTML-parse time, before babel-standalone has even
   processed 10-core.jsx). We mutate its methods in place rather than
   reassigning `API` itself (it's a const). */
API.get  = function(u){ return routeGet(u); };
API.post = function(u,d){ return routePost(u,d); };
API.put  = function(u,d){ return Promise.resolve({error:'not available in the static build'}); };
API.del  = function(u){ return Promise.resolve({error:'not available in the static build'}); };
API.upload = function(u,fd){ return Promise.resolve({error:'not available in the static build'}); };

/* ── reader desk: sign-in pill + "what happened to my submissions" drawer ─────
   Deliberately vanilla DOM rather than a React page in 80-rest.jsx: that file
   is shared with the live app.py build, where none of this exists (real
   sessions, a real DB, real notifications). Keeping the whole surface inside
   the shim means the static build gains it without app.py's SPA changing at
   all -- the same reason the shim owns the puzzle/localStorage layer.

   Everything shown comes from data/reader_state.json, baked at push time; the
   only live call is signup/login. So the drawer is accurate as of the last
   ve-push.py run, not this second, and says so. */
(function readerDesk(){
  function el(tag, cls, txt){
    var n = document.createElement(tag);
    if(cls) n.className = cls;
    if(txt != null) n.textContent = txt;   // textContent, never innerHTML --
    return n;                              // titles/excerpts are reader-authored
  }
  function fmt(d){
    if(!d) return '';
    var t = new Date(d);
    return isNaN(t) ? '' : t.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  }
  /* Editor replies are stored as HTML. A regex tag-strip leaves entities raw
     ("Yes &mdash; it closes."), so parse properly and take the text. DOMParser
     builds an inert document -- no scripts run, no images/network fetched --
     which innerHTML on a detached node does NOT guarantee. */
  function htmlToText(html){
    var s = String(html||'');
    if(!s) return '';
    try{
      var doc = new DOMParser().parseFromString(s,'text/html');
      s = (doc.body && doc.body.textContent) || '';
    }catch(e){
      s = s.replace(/<[^>]+>/g,' ');
    }
    return s.replace(/\s+/g,' ').trim().slice(0,400);
  }

  var host = el('div','ve-desk');
  var pill = el('button','ve-desk-pill');
  var panel = el('div','ve-desk-panel');
  panel.hidden = true;
  host.appendChild(pill); host.appendChild(panel);

  function countNews(st){
    // things the reader probably hasn't seen: an answered letter, a built book,
    // or a comment that didn't make it through moderation
    return st.letters.filter(function(l){ return l.replied; }).length
         + st.ebooks.filter(function(b){ return b.status==='built'; }).length
         + st.comments.filter(function(c){ return c.status && c.status!=='approved'; }).length;
  }

  function renderPill(){
    var u = veUser();
    if(!u){ pill.textContent = 'Sign in'; pill.title = 'Use your Voice Express handle'; return; }
    var n = countNews(veReaderState(u));
    pill.textContent = n ? (u + ' · ' + n) : u;
    pill.title = n ? (n + ' update(s) on your submissions') : 'Your submissions';
  }

  function renderSignedOut(){
    panel.textContent = '';
    panel.appendChild(el('h3','ve-desk-h','Your Voice Express handle'));
    panel.appendChild(el('p','ve-desk-note',
      'The same handle works on the Newsstand. No password — it just lets us '
      + 'show you what happened to your comments, letters and ebook requests.'));
    var input = el('input','ve-desk-input');
    input.placeholder = 'handle'; input.setAttribute('aria-label','Your handle');
    var msg = el('p','ve-desk-msg');
    var rowb = el('div','ve-desk-row');

    function go(mode){
      var u = (input.value||'').trim();
      if(!u){ msg.textContent = 'Enter a handle.'; return; }
      msg.textContent = 'Checking…';
      veAccount(mode, u).then(function(d){
        if(d && d.ok){ veSetUser(d.username || u); return; }
        var e = d && d.error;
        msg.textContent = e==='taken' ? 'That handle is taken — try signing in.'
                        : e==='nouser' ? "No such handle — try creating it."
                        : 'Could not reach the service. Try again.';
      }).catch(function(){ msg.textContent = 'Could not reach the service. Try again.'; });
    }
    var bIn = el('button','ve-desk-btn','Sign in');
    var bUp = el('button','ve-desk-btn','Create');
    bIn.onclick = function(){ go('in'); };
    bUp.onclick = function(){ go('up'); };
    rowb.appendChild(bIn); rowb.appendChild(bUp);
    panel.appendChild(input); panel.appendChild(rowb); panel.appendChild(msg);
  }

  function section(title, items, render){
    var wrap = el('div','ve-desk-sec');
    wrap.appendChild(el('h4','ve-desk-h4', title));
    if(!items.length){ wrap.appendChild(el('p','ve-desk-empty','Nothing yet.')); return wrap; }
    items.forEach(function(it){ wrap.appendChild(render(it)); });
    return wrap;
  }

  function renderSignedIn(){
    var u = veUser(), st = veReaderState(u);
    panel.textContent = '';
    var head = el('div','ve-desk-row');
    head.appendChild(el('h3','ve-desk-h', u));
    var out = el('button','ve-desk-btn','Sign out');
    out.onclick = function(){ veSetUser(''); };
    head.appendChild(out);
    panel.appendChild(head);

    panel.appendChild(section('Letters', st.letters, function(l){
      var d = el('div','ve-desk-item');
      d.appendChild(el('strong', null, l.subject || '(no subject)'));
      if(l.replied){
        d.appendChild(el('span','ve-desk-badge','Answered'));
        (l.replies||[]).forEach(function(r){
          var q = el('div','ve-desk-reply');
          q.textContent = htmlToText(r.content);
          d.appendChild(q);
        });
      } else {
        d.appendChild(el('span','ve-desk-badge ve-desk-badge-wait','Awaiting a reply'));
      }
      d.appendChild(el('div','ve-desk-when', fmt(l.created_at)));
      return d;
    }));

    panel.appendChild(section('Ebook requests', st.ebooks, function(b){
      var d = el('div','ve-desk-item');
      d.appendChild(el('strong', null, b.title || 'Untitled'));
      if(b.status==='built' && b.download_url){
        d.appendChild(el('span','ve-desk-badge','Ready'));
        var a = el('a','ve-desk-link','Download your ebook');
        a.href = b.download_url;   // already relative: emag is a project page
        d.appendChild(a);
      } else {
        d.appendChild(el('span','ve-desk-badge ve-desk-badge-wait','Being built'));
      }
      d.appendChild(el('div','ve-desk-when', fmt(b.built_at)));
      return d;
    }));

    panel.appendChild(section('Comments', st.comments, function(c){
      var d = el('div','ve-desk-item');
      d.appendChild(el('div', null, c.excerpt || ''));
      var ok = !c.status || c.status==='approved';
      var b = el('span','ve-desk-badge'+(ok?'':' ve-desk-badge-no'),
        ok ? 'Published' : (c.status==='pending' ? 'Awaiting review' : 'Not published'));
      d.appendChild(b);
      d.appendChild(el('div','ve-desk-when', fmt(c.created_at)));
      return d;
    }));

    panel.appendChild(el('p','ve-desk-note',
      'Updated when the site was last published — a very recent reply may not show yet.'));
  }

  function draw(){
    renderPill();
    if(!panel.hidden){ veUser() ? renderSignedIn() : renderSignedOut(); }
  }
  pill.onclick = function(){
    panel.hidden = !panel.hidden;
    if(!panel.hidden){ veUser() ? renderSignedIn() : renderSignedOut(); }
  };
  window.addEventListener('ve-user-changed', draw);
  document.addEventListener('click', function(e){
    if(!panel.hidden && !host.contains(e.target)){ panel.hidden = true; }
  });

  // STORE.ready resolves once every data/*.json above has loaded, so
  // reader_state is present before the pill first reports a count.
  STORE.ready.then(function(){
    document.body.appendChild(host);
    draw();
  });
})();

})();

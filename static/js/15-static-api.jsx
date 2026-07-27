/* emag_shim.jsx -- static-build API shim for The Voice Express.
   Copied verbatim by ve-push.py into emag/static/js/15-static-api.jsx, loaded
   right after 10-core.jsx (which defines the global `API` object) and before
   every other page/view script. It monkey-patches API.get/post/put/del so the
   *same* reader-facing JSX used by the live site works unmodified against a
   frozen JSON export instead of the Flask API.

   Data source: ./data/*.json (written by ve-push.py) and, for comments/likes,
   the Apps Script deployment named in ./data/config.json's "api" field (same
   one the Newsstand -- voiceexpressstand/ -- already uses), called via JSONP
   exactly like voiceexpressstand/app.js does (see tools/stand_apps_script.gs).

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
  pages:{}, publications:[], crosswords:{}, config:{api:''}};

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

/* ── localStorage-backed puzzle progress (no accounts in this build) ── */
var LS_KEY = 've-puzzle-sessions';
function lsSessions(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'{}'); }catch(e){ return {}; } }
function lsSaveSessions(s){ try{ localStorage.setItem(LS_KEY, JSON.stringify(s)); }catch(e){} }
function sessionKey(type,date,difficulty){ return type+'|'+date+'|'+(difficulty||''); }

function dayOfYear(ds){ var d=new Date(ds+'T12:00:00'); return Math.floor((d-new Date(d.getFullYear(),0,0))/864e5); }

/* ── query-string helpers ── */
function qs(url){ var i=url.indexOf('?'); var p={}; if(i<0) return p;
  new URLSearchParams(url.slice(i+1)).forEach(function(v,k){ p[k]=v; }); return p; }
function path(url){ var i=url.indexOf('?'); return i<0?url:url.slice(0,i); }

function articleMatches(a,p){
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
    var hay=[a.title,a.content,a.excerpt,a.author_name].join(' ').toLowerCase();
    if(hay.indexOf(q2)<0) return false;
  }
  return true;
}

function listArticles(p){
  var out = STORE.articles.filter(function(a){ return articleMatches(a,p); });
  var offset = parseInt(p.offset||'0',10)||0;
  var limit  = Math.min(parseInt(p.limit||'50',10)||50, 200);
  return out.slice(offset, offset+limit);
}

function findArticle(id){
  return STORE.articles.find(function(a){ return String(a.id)===String(id); }) || null;
}

/* ── main GET router ── */
function routeGet(url){
  return STORE.ready.then(function(){
    var p2 = path(url), params = qs(url), m;

    if(p2==='/api/articles') return listArticles(params);

    if((m=p2.match(/^\/api\/articles\/(\d+)$/))) return findArticle(m[1]);

    if((m=p2.match(/^\/api\/articles\/(\d+)\/comments$/))){
      return jsonp({action:'comments_get', article_id:m[1]}).catch(function(){ return []; });
    }
    if((m=p2.match(/^\/api\/articles\/(\d+)\/translations$/))){
      var a=findArticle(m[1]); return (a&&a.translations)||[];
    }
    if((m=p2.match(/^\/api\/articles\/(\d+)\/translation\/([a-z-]+)$/))){
      var a2=findArticle(m[1]); var t=((a2&&a2.translations)||[]).find(function(x){return x.language===m[2];});
      return t||{error:'not found'};
    }
    if((m=p2.match(/^\/api\/articles\/(\d+)\/corrections$/))){
      var a3=findArticle(m[1]); return (a3&&a3.corrections)||[];
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

    if(p2==='/api/auth/me') return null;   /* no accounts in this build */

    return {error:'not available in the static build'};
  });
}

/* ── main POST router ── */
function routePost(url, data){
  var p2 = path(url), m;
  if((m=p2.match(/^\/api\/articles\/(\d+)\/comments$/))){
    return jsonp({action:'comments_add', article_id:m[1],
      display_name:(data&&data.display_name)||'', content:(data&&data.content)||''}).catch(function(){
        return {error:'Could not reach the comment service. Try again.'};
      });
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

})();

(function() {
    'use strict';

    var B, SVC;
    var booted = false;
    function assertReady() { if (!booted||!SVC||!B) return false; return true; }

    function boot() {
        if (typeof cockpit === 'undefined') { setTimeout(boot, 100); return; }
        cockpit.locale();
        window.CockpitBridge.init(cockpit);
        window.ClamAVServices.init();
        B = window.CockpitBridge; SVC = window.ClamAVServices;
        booted = true; init();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    // ==================== i18n ====================
    var i18nData = {}; var currentLang = 'zh-CN';
    async function loadLang(lang) { if (i18nData[lang]) return; try { var r = await fetch('lang/'+lang+'.json'); i18nData[lang] = await r.json(); } catch(e){} }
    function t(key) { return (i18nData[currentLang]&&i18nData[currentLang][key])||key; }
    function updateAllI18n() {
        document.querySelectorAll('[data-i18n]').forEach(function(el) { var k=el.getAttribute('data-i18n'); if(el.tagName==='INPUT'||el.tagName==='TEXTAREA') el.placeholder=t(k); else el.textContent=t(k); });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el){el.placeholder=t(el.getAttribute('data-i18n-placeholder'));});
        document.querySelectorAll('[data-i18n-title]').forEach(function(el){el.title=t(el.getAttribute('data-i18n-title'));});
        document.querySelectorAll('[data-i18n-aria]').forEach(function(el){el.setAttribute('aria-label',t(el.getAttribute('data-i18n-aria')));});
    }

    // ==================== State ====================
    var STORAGE_KEY = 'cockpit_clamav_settings';
    var SETTINGS_FILE = '/etc/cockpit/cockpit-clamav/setting.json';
    var state = {
        theme:'light',lang:'zh-CN',accentColor:'#4f6ef7',toastDuration:4,menuLayout:'side',
        sidebarOpen:true,mobileSidebarOpen:false,
        totalScanned:0,totalInfected:0,lastScanTime:null,lastDuration:'--',
        realtimeEnabled:false,quarantineItems:[],scheduledTasks:[],
        scanHistory:[],logRetentionDays:30,scanExclude:'/proc,/sys,/dev',scanThreads:4,
    };
    var ALL_SETTINGS_KEYS = ['theme','lang','accentColor','toastDuration','menuLayout','logRetentionDays','scheduledTasks','scanExclude','scanThreads','totalScanned','totalInfected','lastScanTime','lastDuration','quarantineItems','scanHistory','realtimeEnabled'];

    // File I/O via cockpit.file API
    var fileSettings = null;
    var fileScanLog = null;

    function saveState() { try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(e){} schedulePersist(); }
    var _persistTimer=null;
    function schedulePersist(){if(_persistTimer)clearTimeout(_persistTimer);_persistTimer=setTimeout(function(){_persistTimer=null;persistSettingsToFile();},1000);}
    function loadState() { try{var r=localStorage.getItem(STORAGE_KEY);if(r)Object.assign(state,JSON.parse(r));}catch(e){} }
    function persistSettingsToFile() {
        var s={}; ALL_SETTINGS_KEYS.forEach(function(k){s[k]=state[k];});
        var json=JSON.stringify(s,null,2)+'\n';
        try{
            if(!fileSettings) fileSettings=cockpit.file(SETTINGS_FILE,{superuser:'try'});
            fileSettings.replace(json).catch(function(e){console.warn('[app] persistSettingsToFile:',e);});
        }catch(e){}
    }
    async function loadSettingsFromFile() {
        try {
            if(!fileSettings) fileSettings=cockpit.file(SETTINGS_FILE,{superuser:'try'});
            var c=await fileSettings.read();
            if(c&&c.trim()){
                var fs=JSON.parse(c.trim());
                if(typeof fs!=='object'||Array.isArray(fs))return;
                ALL_SETTINGS_KEYS.forEach(function(k){
                    if(fs[k]!==undefined&&typeof fs[k]===typeof state[k])state[k]=fs[k];
                });
            }
        } catch(e){console.warn('[app] loadSettingsFromFile:',e.message||e);}
    }

    // ==================== DOM ====================
    var $html=document.documentElement,$body=document.body;
    var $sidebar=document.getElementById('sidebar'),$sidebarOverlay=document.getElementById('sidebarOverlay');
    var $sidebarNav=document.getElementById('sidebarNav'),$topMenuBar=document.getElementById('topMenuBar');
    var $hamburgerBtn=document.getElementById('hamburgerBtn');
    var $notifPanel=document.getElementById('notifPanel'),$notifBadge=document.getElementById('notifBadge'),$notifList=document.getElementById('notifList');
    var $statusDot=document.getElementById('statusDot'),$toastContainer=document.getElementById('toastContainer');
    var $themeIconSun=document.getElementById('themeIconSun'),$themeIconMoon=document.getElementById('themeIconMoon');
    var $settingsOverlay=document.getElementById('settingsOverlay');

    // ==================== Menu ====================
    var menuItems = [
        {id:'dashboard',icon:'grid',labelKey:'menuDashboard',section:'main'},
        {id:'scan',icon:'search',labelKey:'menuScan',section:'main'},
        {id:'quarantine',icon:'archive',labelKey:'menuQuarantine',section:'main'},
        {id:'scheduled',icon:'calendar',labelKey:'menuScheduled',section:'main'},
        {id:'divider1',type:'divider'},
        {id:'config',icon:'settings2',labelKey:'menuConfig',section:'system'},
        {id:'history',icon:'clock',labelKey:'menuHistory',section:'system'},
        {id:'definitions',icon:'database',labelKey:'menuDefinitions',section:'system'},
    ];
    var menuIcons = {
        grid:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
        search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
        archive:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
        clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        calendar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        database:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
        settings2:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    };
    var sectionLabels = {main:'menuSectionMain',system:'menuSectionSystem'};
    var notifItems = [];

    // ==================== Theme ====================
    function applyTheme(theme) {
        state.theme=theme;
        if(theme==='system') $html.setAttribute('data-theme',window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
        else $html.setAttribute('data-theme',theme);
        var dark=$html.getAttribute('data-theme')==='dark';
        $themeIconSun.style.display=dark?'none':''; $themeIconMoon.style.display=dark?'':'none';
        applyAccentColor(state.accentColor); saveState();
    }
    function toggleTheme(){applyTheme($html.getAttribute('data-theme')==='dark'?'light':'dark');showToast(t('toastThemeChanged'),'success',2.5);}
    function hexToRgb(h){return{r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)};}
    function applyAccentColor(c){
        state.accentColor=c;var rgb=hexToRgb(c);
        var h2=function(v,d){return Math.max(0,v-d).toString(16).padStart(2,'0');};
        var l2=function(v,d){return Math.min(255,v+d).toString(16).padStart(2,'0');};
        $html.style.setProperty('--accent',c);
        $html.style.setProperty('--accent-hover','#'+h2(rgb.r,20)+h2(rgb.g,20)+h2(rgb.b,20));
        $html.style.setProperty('--accent-light','rgba('+rgb.r+','+rgb.g+','+rgb.b+',0.1)');
        $html.style.setProperty('--accent-glow','rgba('+rgb.r+','+rgb.g+','+rgb.b+',0.25)');
        if($html.getAttribute('data-theme')==='dark'){
            $html.style.setProperty('--accent-hover','#'+l2(rgb.r,30)+l2(rgb.g,30)+l2(rgb.b,30));
            $html.style.setProperty('--accent-light','rgba('+rgb.r+','+rgb.g+','+rgb.b+',0.15)');
        }
        document.querySelectorAll('.logo-icon').forEach(function(el){el.style.background='linear-gradient(135deg,'+c+',#e53e3e)';});
        document.querySelectorAll('.color-swatch').forEach(function(el){el.classList.toggle('active',el.dataset.color===c);});
        saveState();
    }

    // ==================== Toast ====================
    function showToast(msg,type,dur){
        type=type||'info';dur=dur||state.toastDuration;
        var icons={success:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>',error:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',warning:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'};
        var el=document.createElement('div');el.className='toast toast-'+type;
        el.innerHTML='<span class="toast-icon">'+(icons[type]||icons.info)+'</span><span class="toast-body">'+msg+'</span><button class="toast-close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
        el.querySelector('.toast-close').addEventListener('click',function(){rmT(el);});
        $toastContainer.appendChild(el);
        if($toastContainer.querySelectorAll('.toast').length>5)rmT($toastContainer.firstChild);
        el._t=setTimeout(function(){rmT(el);},dur*1000);
    }
    function rmT(el){if(el._rm)return;el._rm=true;clearTimeout(el._t);el.classList.add('removing');setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el);},400);}

    // ==================== Menu Build ====================
    function buildMenus(){
        var sHTML='',tHTML='',sec=null;
        menuItems.forEach(function(i){
            if(i.type==='divider'){sHTML+='<div class="menu-divider"></div>';sec=null;return;}
            if(i.section!==sec&&sectionLabels[i.section]){sHTML+='<div class="menu-label">'+t(sectionLabels[i.section])+'</div>';sec=i.section;}
            sHTML+='<div class="menu-item" data-menu-id="'+i.id+'"><span class="menu-icon">'+(menuIcons[i.icon]||'')+'</span><span>'+t(i.labelKey)+'</span></div>';
            tHTML+='<div class="menu-item" data-menu-id="'+i.id+'"><span class="menu-icon">'+(menuIcons[i.icon]||'')+'</span><span>'+t(i.labelKey)+'</span></div>';
        });
        $sidebarNav.innerHTML=sHTML;$topMenuBar.innerHTML=tHTML;
        document.querySelectorAll('.menu-item[data-menu-id]').forEach(function(el){el.addEventListener('click',function(){setActiveMenu(el.dataset.menuId);if(window.innerWidth<=768)closeMobileSidebar();});});
    }
    function setActiveMenu(id){
        document.querySelectorAll('.menu-item[data-menu-id]').forEach(function(el){el.classList.toggle('active',el.dataset.menuId===id);});
        document.querySelectorAll('.page-section').forEach(function(el){el.classList.remove('active');});
        var tgt=document.getElementById('sec-'+id);if(tgt)tgt.classList.add('active');
        if(id==='config')reloadClamdConf();
    }

    // ==================== Layout ====================
    function getEffectiveLayout(){return state.menuLayout==='top'?'top':'side';}
    function applyMenuLayout(layout){
        state.menuLayout=layout;
        if(layout==='top'){$body.classList.add('menu-top');$body.classList.remove('menu-side','sidebar-collapsed');$sidebar.classList.add('collapsed');$sidebar.classList.remove('mobile-open');$sidebarOverlay.classList.remove('show');state.mobileSidebarOpen=false;$hamburgerBtn.style.display='none';}
        else{$body.classList.remove('menu-top');$body.classList.add('menu-side');$sidebar.classList.remove('collapsed');state.sidebarOpen=true;$hamburgerBtn.style.display='flex';if(window.innerWidth<=768){$sidebar.classList.add('collapsed');state.sidebarOpen=false;}$body.classList.toggle('sidebar-collapsed',$sidebar.classList.contains('collapsed'));}
        var e=getEffectiveLayout();document.getElementById('layoutIconTop').style.display=e==='top'?'none':'';document.getElementById('layoutIconSide').style.display=e==='top'?'':'none';
        saveState();
    }
    function toggleMenuLayout(){var n=getEffectiveLayout()==='side'?'top':'side';applyMenuLayout(n);setCSVal('settingMenuLayout',n);showToast(t('toastMenuLayoutChanged'),'success',2.5);}

    // ==================== Sidebar ====================
    function toggleSidebar(){if(window.innerWidth<=768){state.mobileSidebarOpen?closeMobileSidebar():openMobileSidebar();}else{state.sidebarOpen=!state.sidebarOpen;$sidebar.classList.toggle('collapsed',!state.sidebarOpen);$body.classList.toggle('sidebar-collapsed',!state.sidebarOpen);saveState();}}
    function openMobileSidebar(){state.mobileSidebarOpen=true;$sidebar.classList.add('mobile-open');$sidebar.classList.remove('collapsed');$sidebarOverlay.classList.add('show');document.body.style.overflow='hidden';}
    function closeMobileSidebar(){state.mobileSidebarOpen=false;$sidebar.classList.remove('mobile-open');$sidebar.classList.add('collapsed');$sidebarOverlay.classList.remove('show');document.body.style.overflow='';}

    // ==================== Notifications ====================
    function updateNotifBadge(){var u=notifItems.filter(function(n){return n.unread;}).length;if(u>0){$notifBadge.style.display='flex';$notifBadge.textContent=u>99?'99+':u;}else{$notifBadge.style.display='none';}}
    function renderNotifPanel(){if(!notifItems.length){$notifList.innerHTML='<div style="text-align:center;padding:30px;color:var(--text-tertiary);">'+t('noNotif')+'</div>';return;}$notifList.innerHTML=notifItems.map(function(n){return'<div class="notif-item '+(n.unread?'unread':'')+'" data-id="'+n.id+'"><div>'+t(n.textKey)+'</div><div class="notif-time">'+t(n.timeKey)+'</div></div>';}).join('');$notifList.querySelectorAll('.notif-item').forEach(function(el){el.addEventListener('click',function(){var n=notifItems.find(function(x){return x.id===+el.dataset.id;});if(n&&n.unread){n.unread=false;updateNotifBadge();renderNotifPanel();}});});}
    function addNotif(key){notifItems.unshift({id:Date.now(),textKey:key,timeKey:'notifTime1',unread:true});updateNotifBadge();renderNotifPanel();}

    // ==================== Confirm ====================
    var confirmResolve=null;
    function openConfirm(title,msg){document.getElementById('confirmTitle').textContent=title;document.getElementById('confirmMsg').textContent=msg;document.getElementById('confirmOverlay').classList.add('show');document.body.style.overflow='hidden';return new Promise(function(r){confirmResolve=r;});}
    function closeConfirm(ok){
        document.getElementById('confirmOverlay').classList.remove('show');
        document.body.style.overflow='';
        document.getElementById('confirmBtn').textContent=t('btnConfirm')||'确认';
        document.getElementById('confirmBtn').className='btn btn-danger';
        document.getElementById('confirmMsg').style.whiteSpace='pre-line';
        if(confirmResolve){confirmResolve(ok);confirmResolve=null;}
    }

    // ==================== Custom Select ====================
    function getCSVal(f){var el=document.querySelector('.custom-select[data-field="'+f+'"]');if(!el)return'';var s=el.querySelector('.selected');return s?s.dataset.value:'';}
    function setCSVal(f,v){var el=document.querySelector('.custom-select[data-field="'+f+'"]');if(!el)return;el.querySelectorAll('.custom-select-option').forEach(function(o){var is=o.dataset.value===v;o.classList.toggle('selected',is);if(is)el.querySelector('.custom-select-value').textContent=o.textContent;});}
    function initCustomSelects(){
        document.querySelectorAll('.custom-select').forEach(function(cs){
            cs.querySelector('.custom-select-trigger').addEventListener('click',function(e){e.stopPropagation();document.querySelectorAll('.custom-select.open').forEach(function(o){if(o!==cs)o.classList.remove('open');});cs.classList.toggle('open');});
            cs.querySelectorAll('.custom-select-option').forEach(function(opt){opt.addEventListener('click',function(){
                var f=cs.dataset.field;setCSVal(f,opt.dataset.value);cs.classList.remove('open');
                if(f==='settingTheme')applyTheme(opt.dataset.value);
                else if(f==='settingLang'){state.lang=opt.dataset.value;currentLang=state.lang;$html.lang=currentLang;updateAllI18n();buildMenus();setActiveMenu(document.querySelector('.menu-item.active')?document.querySelector('.menu-item.active').dataset.menuId:'dashboard');refreshStatus();syncRealtimeStatus();updateDashboardStats();renderQuarantine();renderHistory();renderScheduledList();saveState();showToast(t('toastLangChanged'),'success',2.5);}
                else if(f==='settingMenuLayout'){applyMenuLayout(opt.dataset.value);buildMenus();setActiveMenu(document.querySelector('.menu-item.active')?document.querySelector('.menu-item.active').dataset.menuId:'dashboard');}
                else if(f==='schedEditCronMode'){document.getElementById('schedSimpleFields').style.display=opt.dataset.value==='simple'?'':'none';document.getElementById('schedCronFields').style.display=opt.dataset.value==='cron'?'':'none';}
                else if(f==='schedEditFreq'){document.getElementById('schedDowGroup').style.display=opt.dataset.value==='weekly'?'':'none';document.getElementById('schedDomGroup').style.display=opt.dataset.value==='monthly'?'':'none';}
            });});
        });
        document.addEventListener('click',function(){document.querySelectorAll('.custom-select.open').forEach(function(c){c.classList.remove('open');});});
    }

    // ==================== Settings Modal ====================
    function openSettings(){setCSVal('settingTheme',state.theme);setCSVal('settingLang',state.lang);setCSVal('settingMenuLayout',state.menuLayout);document.getElementById('settingToastDuration').value=state.toastDuration;document.getElementById('settingLogRetention').value=state.logRetentionDays||30;document.querySelectorAll('.color-swatch').forEach(function(el){el.classList.toggle('active',el.dataset.color===state.accentColor);});$settingsOverlay.classList.add('show');document.body.style.overflow='hidden';}
    function closeSettings(){$settingsOverlay.classList.remove('show');document.body.style.overflow='';document.querySelectorAll('.custom-select.open').forEach(function(c){c.classList.remove('open');});}
    function saveSettingsFromPanel(){var nt=getCSVal('settingTheme'),nl=getCSVal('settingLang'),nml=getCSVal('settingMenuLayout');var nd=parseFloat(document.getElementById('settingToastDuration').value)||4;var lr=Math.max(1,Math.min(365,parseInt(document.getElementById('settingLogRetention').value)||30));if(nt&&nt!==state.theme)applyTheme(nt);if(nl){state.lang=nl;currentLang=nl;$html.lang=currentLang;updateAllI18n();buildMenus();setActiveMenu(document.querySelector('.menu-item.active')?document.querySelector('.menu-item.active').dataset.menuId:'dashboard');refreshStatus();syncRealtimeStatus();updateDashboardStats();renderQuarantine();renderHistory();renderScheduledList();}if(nml&&nml!==state.menuLayout)applyMenuLayout(nml);state.toastDuration=Math.max(1,Math.min(15,nd));state.logRetentionDays=lr;saveState();closeSettings();showToast(t('toastSettingsSaved'),'success');}
    function resetSettings(){state.theme='light';state.lang='zh-CN';state.accentColor='#4f6ef7';state.toastDuration=4;state.menuLayout='side';state.logRetentionDays=30;state.scanExclude='/proc,/sys,/dev';state.scanThreads=4;currentLang='zh-CN';$html.lang='zh-CN';applyTheme('light');applyAccentColor('#4f6ef7');applyMenuLayout('side');setCSVal('settingTheme','light');setCSVal('settingLang','zh-CN');setCSVal('settingMenuLayout','side');document.getElementById('settingToastDuration').value='4';document.getElementById('settingLogRetention').value='30';updateAllI18n();buildMenus();setActiveMenu('dashboard');refreshStatus();syncRealtimeStatus();updateDashboardStats();renderQuarantine();renderHistory();renderScheduledList();saveState();showToast(t('toastSettingsReset'),'info');}

    // ==================== Service Status ====================
    async function refreshStatus(){
        if(!assertReady())return;
        var list=document.getElementById('serviceStatusList');list.innerHTML='<div style="text-align:center;padding:12px;color:var(--text-tertiary);"><span class="spinner spinner-sm"></span></div>';
        var allOk=true,html='',services=SVC.getAll();
        for(var i=0;i<services.length;i++){var s=services[i];var running=s.exists&&s.state==='running';if(!running)allOk=false;var dotClass=running?'active':(s.state==='failed'?'failed':'inactive');var statusLabel=running?t('svcActive'):(s.state==='failed'?t('svcFailed'):t('svcInactive'));var enabledTag=s.enabled===true?' <span style="font-size:0.7rem;color:var(--success)">enabled</span>' :(s.enabled===false?' <span style="font-size:0.7rem;color:var(--text-tertiary)">disabled</span>':'');var unitName=s.unit&&s.unit.Id?s.unit.Id:s.def.unit;html+='<div class="service-status-item"><div class="svc-dot '+dotClass+'"></div><div style="flex:1;"><div class="svc-name">'+t(s.def.nameKey)+enabledTag+'</div><div class="svc-desc">'+t(s.def.descKey)+' · <code style="font-size:0.72rem;color:var(--text-tertiary);background:var(--bg-tertiary);padding:1px 5px;border-radius:4px;">'+unitName+'</code></div></div><div class="svc-status '+dotClass+'">'+statusLabel+'</div></div>';}
        list.innerHTML=html;$statusDot.className='status-dot '+(allOk?'online':'offline');document.getElementById('footerStatus').textContent=allOk?t('serviceNormal'):t('serviceDegraded');
    }

    // ==================== Service Control ====================
    async function startAllServices(){
        if(!assertReady())return;
        try{await SVC.start('clamav-daemon.service');}catch(e){}
        try{await SVC.start('clamav-freshclam.service');}catch(e){}
        showToast(t('svcStarted')||'服务已启动','success');await refreshStatus();syncRealtimeStatus();
    }
    async function stopAllServices(){
        if(!assertReady())return;
        try{await SVC.stop('clamav-daemon.service');}catch(e){}
        try{await SVC.stop('clamav-freshclam.service');}catch(e){}
        showToast(t('svcStopped')||'服务已停止','warning');await refreshStatus();syncRealtimeStatus();
    }
    async function restartAllServices(){
        if(!assertReady())return;
        try{await SVC.restart('clamav-daemon.service');}catch(e){}
        try{await SVC.restart('clamav-freshclam.service');}catch(e){}
        showToast(t('svcRestarted')||'服务已重启','success');await refreshStatus();syncRealtimeStatus();
    }

    // ==================== Realtime ====================
    function updateRealtimeUI(){var toggle=document.getElementById('realtimeToggle');var card=document.getElementById('realtimeCard');var desc=document.getElementById('realtimeDesc');toggle.checked=state.realtimeEnabled;card.classList.toggle('enabled',state.realtimeEnabled);card.classList.toggle('disabled',!state.realtimeEnabled);desc.textContent=state.realtimeEnabled?t('realtimeEnabled'):t('realtimeDisabled');document.getElementById('statRealtime').textContent=state.realtimeEnabled?t('svcActive'):t('svcInactive');}
    function syncRealtimeStatus(){if(!assertReady())return;SVC.ready().then(function(){state.realtimeEnabled=SVC.isClamdRunning();updateRealtimeUI();}).catch(function(){});}
    async function toggleRealtime(enabled){if(!assertReady())return;if(!enabled){var ok=await openConfirm(t('realtimeDisableConfirmTitle')||'关闭实时防护',t('realtimeDisableConfirmMsg')||'确定关闭？');if(!ok){document.getElementById('realtimeToggle').checked=true;return;}}try{if(enabled)await SVC.start('clamav-daemon.service');else await SVC.stop('clamav-daemon.service');state.realtimeEnabled=enabled;updateRealtimeUI();showToast(enabled?t('notifRealtimeEnabled'):t('notifRealtimeDisabled'),enabled?'success':'warning');addNotif(enabled?'notifRealtimeEnabled':'notifRealtimeDisabled');await refreshStatus();}catch(e){showToast(t('toastOperationFailed')+': '+(e.message||e.problem||e),'error');document.getElementById('realtimeToggle').checked=!enabled;}}

    // ==================== Scanning ====================
    var scanRunning=false,scanProcs=[],scanPids=[];
    var SCAN_LOG_FILE='/var/log/cockpit-clamav-scan.log';

    function appendLogLine(container,parsed){
        if(parsed.type==='error')return;
        while(container.childElementCount>3000)container.removeChild(container.firstChild);
        var line=document.createElement('div');line.className='log-line log-'+parsed.type;
        if(parsed.type==='infected')line.innerHTML='<span class="log-tag tag-danger">⚠ '+parsed.virus+'</span> <span class="log-path">'+parsed.path+'</span>';
        else if(parsed.type==='clean')line.innerHTML='<span class="log-tag tag-success">✓</span> <span class="log-path">'+parsed.path+'</span>';
        else if(parsed.type==='header')line.innerHTML='<strong>'+parsed.text+'</strong>';
        else line.textContent=parsed.text||'';
        container.appendChild(line);container.scrollTop=container.scrollHeight;
    }
    function writeScanLog(record){
        var ts=new Date().toISOString();var logLine='['+ts+'] '+record.target+' | files='+record.totalFiles+' infected='+record.infectedCount+' duration='+record.duration+'s scanner='+record.scanner;if(record.error)logLine+=' ERROR='+record.error;logLine+='\n';
        if(record.infectedList)record.infectedList.forEach(function(item){logLine+='['+ts+'] INFECTED: '+item.path+' => '+item.virus+'\n';});
        try{
            if(!fileScanLog) fileScanLog=cockpit.file(SCAN_LOG_FILE,{superuser:'try'});
            fileScanLog.modify(function(content){return(content||'')+logLine;}).catch(function(e){console.warn('[scan] writeScanLog:',e);});
        }catch(e){}rotateScanLogs();
    }
    function rotateScanLogs(){
        var rd=state.logRetentionDays||30;var cd=new Date();cd.setDate(cd.getDate()-rd);var cutoff=cd.toISOString().substring(0,10);
        try{
            if(!fileScanLog) fileScanLog=cockpit.file(SCAN_LOG_FILE,{superuser:'try'});
            fileScanLog.read().then(function(content){
                if(!content)return;
                var lines=content.split('\n');var filtered=[];
                for(var i=0;i<lines.length;i++){
                    if(lines[i].match(/^\[/)){var m=lines[i].match(/^\[(\d{4}-\d{2}-\d{2})/);if(m&&m[1]>=cutoff)filtered.push(lines[i]);}
                    else if(filtered.length)filtered.push(lines[i]);
                }
                fileScanLog.replace(filtered.join('\n')).catch(function(){});
            }).catch(function(){});
        }catch(e){}
    }

    async function doScan(rawArgs,label){
        if(!assertReady()||scanRunning)return;
        var paths=rawArgs.filter(function(a){return!a.startsWith('-');});var scanner='clamscan';
        try{await B.spawn(['which',scanner]);}catch(e){showToast(t('scanNotInstalled')||scanner+' 未安装','error',6);return;}
        var excludeDirs=document.getElementById('scanExclude').value.split(',').map(function(s){return s.trim();}).filter(Boolean);
        var numThreads=parseInt(getCSVal('scanThreads'))||4;
        var excludeFlags=excludeDirs.map(function(d){return'--exclude-dir='+d;}).join(' ');
        var ok=await openConfirm(t('scanConfirmTitle')||'确认扫描',(t('scanConfirmMsg')||'即将扫描：')+'\n\n'+paths.join(', '));if(!ok)return;
        scanRunning=true;
        var progressArea=document.getElementById('scanProgressArea'),summaryArea=document.getElementById('scanSummaryArea'),resultsList=document.getElementById('scanResultsList');
        var scanBtn=document.getElementById('scanBtn'),scanStopBtn=document.getElementById('scanStopBtn');
        var statusText=document.getElementById('scanStatusText'),percentText=document.getElementById('scanPercentText'),progressBar=document.getElementById('scanProgressBar');
        var currentFile=document.getElementById('scanCurrentFile'),logArea=document.getElementById('scanLogArea'),logContent=document.getElementById('scanLogContent');
        progressArea.classList.add('active');summaryArea.style.display='none';resultsList.innerHTML='';logArea.style.display='';logContent.innerHTML='';
        scanBtn.style.display='none';scanStopBtn.style.display='';statusText.textContent=t('scanScanning');progressBar.style.width='0%';progressBar.className='progress-fill fill-accent';percentText.textContent='0%';
        currentFile=label+' ('+scanner+', '+numThreads+' threads)';appendLogLine(logContent,{type:'header',text:'Scanner: '+scanner+' | Threads: '+numThreads+' | Paths: '+paths.join(', ')});
        var totalFiles=0,infectedCount=0,fileCount=0,infected=[],startTime=Date.now();scanProcs=[];
        function onFileScanned(isInf,path,virus){fileCount++;if(isInf){infectedCount++;infected.push({path:path,virus:virus});}}
        function onStats(total){if(total>totalFiles)totalFiles=total;}
        var updateProgress=setInterval(function(){if(!scanRunning)return;var el=((Date.now()-startTime)/1000).toFixed(0);currentFile=label+' — '+fileCount+' files — '+infectedCount+' infected — '+el+'s';if(totalFiles>0){var pct=Math.min(99,Math.round((fileCount/totalFiles)*100));progressBar.style.width=pct+'%';percentText.textContent=pct+'%';}},500);
        function scanOnePath(scanPath){
            var safePath=scanPath.replace(/[^a-zA-Z0-9\/\.\-\_]/g,'');
            if(!safePath||safePath!==scanPath){appendLogLine(logContent,{type:'error',text:'INVALID PATH: '+scanPath});return Promise.resolve();}
            var args=[scanner,'-r','--verbose'];
            if(excludeFlags)excludeFlags.split(' ').filter(Boolean).forEach(function(f){args.push(f);});
            args.push(safePath);
            appendLogLine(logContent,{type:'info',text:'$ '+args.join(' ')});
            return new Promise(function(resolve,reject){
                var proc=cockpit.spawn(args,{err:'out'});scanProcs.push(proc);
                var ch=proc.channel||proc;if(ch&&ch.addEventListener)ch.addEventListener('spawn',function(ev,pid){if(pid)scanPids.push(pid);});
                var buffer='';proc.stream(function(data){if(!scanRunning)return;buffer+=data;var lines=buffer.split('\n');buffer=lines.pop();lines.forEach(function(line){line=line.trim();if(!line)return;if(line.endsWith(' FOUND')){var idx=line.lastIndexOf(': ');var p=line.substring(0,idx);var v=line.substring(idx+2).replace(' FOUND','');appendLogLine(logContent,{type:'infected',path:p,virus:v});onFileScanned(true,p,v);}else if(line.endsWith(' OK')){appendLogLine(logContent,{type:'clean',path:line.replace(' OK','')});onFileScanned(false,line.replace(' OK',''),null);}else if(line.match(/Scanned files:\s+(\d+)/)){onStats(parseInt(line.match(/Scanned files:\s+(\d+)/)[1]));}else if(line.match(/^-{3,}/)||line.includes('SCAN SUMMARY')){appendLogLine(logContent,{type:'header',text:line});}else if(line.match(/^Time:\s+/)){appendLogLine(logContent,{type:'info',text:line});}else if(line.includes('Error')||line.includes('ERROR')){appendLogLine(logContent,{type:'error',text:line});}});});
                proc.done(function(){if(buffer.trim()){var l=buffer.trim();if(l.endsWith(' OK'))onFileScanned(false,l.replace(' OK',''),null);else if(l.endsWith(' FOUND')){var i2=l.lastIndexOf(': ');onFileScanned(true,l.substring(0,i2),l.substring(i2+2).replace(' FOUND',''));}}resolve();});
                proc.fail(function(ex){if(scanRunning)reject(ex);else resolve();});
            });
        }
        try{
            var bs=Math.min(numThreads,paths.length);for(var i=0;i<paths.length;i+=bs){var batch=paths.slice(i,i+bs);await Promise.all(batch.map(function(p){return scanOnePath(p);}));}
            clearInterval(updateProgress);var elapsed=((Date.now()-startTime)/1000).toFixed(1);progressBar.style.width='100%';percentText.textContent='100%';currentFile=label;if(!totalFiles)totalFiles=fileCount;
            document.getElementById('scanResultTotal').textContent=totalFiles;document.getElementById('scanResultClean').textContent=totalFiles-infectedCount;document.getElementById('scanResultInfected').textContent=infectedCount;document.getElementById('scanResultDuration').textContent=elapsed+'s';summaryArea.style.display='';
            if(infectedCount>0){statusText.textContent=t('scanResultInfected')+' ('+infectedCount+')';progressBar.className='progress-fill fill-danger';infected.forEach(function(item){resultsList.innerHTML+='<div class="scan-result-card infected"><div class="result-header"><span class="status-badge danger">'+item.virus+'</span></div><div class="result-path">'+item.path+'</div></div>';if(!state.quarantineItems.find(function(q){return q.path===item.path;}))state.quarantineItems.push({id:Date.now()+Math.random(),path:item.path,virus:item.virus,date:new Date().toISOString()});});state.totalInfected+=infectedCount;addNotif('notifThreatDetected');}
            else{statusText.textContent=t('scanResultClean');progressBar.className='progress-fill fill-success';resultsList.innerHTML='<div class="scan-result-card clean"><div class="result-header"><span class="status-badge success">'+t('scanResultClean')+'</span></div><div class="result-detail">'+totalFiles+' '+t('statFiles')+'</div></div>';}
            var record={time:new Date().toISOString(),target:label,paths:paths.join(','),scanner:scanner,totalFiles:totalFiles,infectedCount:infectedCount,duration:elapsed+'s'};state.scanHistory.unshift(record);if(state.scanHistory.length>50)state.scanHistory=state.scanHistory.slice(0,50);
            state.totalScanned+=totalFiles;state.lastScanTime=record.time;state.lastDuration=elapsed+'s';
            updateDashboardStats();renderQuarantine();renderHistory();saveState();
            appendLogLine(logContent,{type:'header',text:'=== Done: '+totalFiles+' files, '+infectedCount+' infected, '+elapsed+'s ==='});
            writeScanLog({target:label,totalFiles:totalFiles,infectedCount:infectedCount,duration:elapsed,scanner:scanner,infectedList:infected});
        }catch(e){clearInterval(updateProgress);statusText.textContent=t('scanError');progressBar.className='progress-fill fill-danger';var errMsg=e.message||e.problem||(typeof e==='string'?e:JSON.stringify(e));appendLogLine(logContent,{type:'error',text:'ERROR: '+errMsg});showToast(t('toastOperationFailed'),'error');writeScanLog({target:label,totalFiles:fileCount,infectedCount:infectedCount,duration:((Date.now()-startTime)/1000).toFixed(1),scanner:scanner,error:errMsg});}
        finally{scanRunning=false;killAllScans();scanBtn.style.display='';scanStopBtn.style.display='none';clearInterval(updateProgress);}
    }
    function startCustomScan(){var p=document.getElementById('scanPath').value.trim();if(!p){showToast(t('scanNoPath'),'warning');return;}doScan([p],p);}
    function scanPreset(el){var p=el.dataset.paths;if(!p)return;doScan(p.split(','),el.querySelector('.preset-label').textContent);}
    function scanMemory(){doScan(['/tmp','/var/tmp','/dev/shm'],t('scanMemory'));}
    function killAllScans(){if(scanPids.length>0){var k='kill '+scanPids.join(' ')+' 2>/dev/null; sleep 0.2; kill -9 '+scanPids.join(' ')+' 2>/dev/null; true';cockpit.spawn(['bash','-c',k],{err:'ignore'});}scanProcs.forEach(function(p){try{p.close();}catch(e){}});scanProcs=[];scanPids=[];}
    function stopScan(){scanRunning=false;killAllScans();document.getElementById('scanStatusText').textContent=t('scanStopped');showToast(t('scanStopped'),'warning');document.getElementById('scanBtn').style.display='';document.getElementById('scanStopBtn').style.display='none';}

    // ==================== Scan History ====================
    function renderHistory(){var list=document.getElementById('historyList');if(!state.scanHistory||!state.scanHistory.length){list.innerHTML='<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="empty-text">'+t('historyEmpty')+'</div></div>';return;}list.innerHTML=state.scanHistory.map(function(r){return'<div class="scan-history-item"><div class="sh-time">'+new Date(r.time).toLocaleString()+'</div><div class="sh-target">'+r.target+'</div><div class="sh-stats"><div class="sh-stat clean">✓ '+r.totalFiles+'</div>'+(r.infectedCount>0?'<div class="sh-stat infected">⚠ '+r.infectedCount+'</div>':'')+'</div><div class="sh-duration">'+r.duration+'</div></div>';}).join('');}
    function refreshHistory(){renderHistory();showToast(t('toastOperationSuccess'),'success',2);}
    async function clearHistory(){var ok=await openConfirm(t('historyClearConfirm')||'清空记录',t('historyClearMsg')||'确定清空？');if(!ok)return;state.scanHistory=[];renderHistory();saveState();showToast(t('toastOperationSuccess'),'success');}

    // ==================== Scheduled Scans ====================
    var editingTaskId=null;
    var _schedulerTimer=null;
    var _lastScheduleMinute=-1;

    function cronToHuman(cron){
        if(!cron)return'';var parts=cron.trim().split(/\s+/);if(parts.length<5)return cron;
        var min=parts[0],hr=parts[1],dom=parts[2],mon=parts[3],dow=parts[4];
        var dowNames=['日','一','二','三','四','五','六'];
        if(dow!=='*'){var d=parseInt(dow);return'每周'+(dowNames[d]||d)+' '+hr.padStart(2,'0')+':'+min.padStart(2,'0');}
        if(dom!=='*')return'每月'+dom+'日 '+hr.padStart(2,'0')+':'+min.padStart(2,'0');
        return'每天 '+hr.padStart(2,'0')+':'+min.padStart(2,'0');
    }

    // ---- Cron expression matching ----
    function cronFieldMatch(field,val){if(field==='*')return true;if(field===String(val))return true;if(field.indexOf(',')!==-1)return field.split(',').some(function(p){return p.trim()===String(val);});if(field.indexOf('-')!==-1){var r=field.split('-');return val>=parseInt(r[0])&&val<=parseInt(r[1]);}if(field.indexOf('/')!==-1){var step=parseInt(field.split('/')[1]);return val%step===0;}return false;}
    function isCronDue(expr,dt){
        var p=expr.trim().split(/\s+/);if(p.length<5)return false;
        return cronFieldMatch(p[0],dt.getMinutes())&&cronFieldMatch(p[1],dt.getHours())&&cronFieldMatch(p[2],dt.getDate())&&cronFieldMatch(p[3],dt.getMonth()+1)&&cronFieldMatch(p[4],dt.getDay());
    }
    function getTaskCronExpr(task){
        if(task.cronMode==='cron'&&task.cron)return task.cron;
        var time=(task.time||'03:00').split(':');var hr=parseInt(time[0])||3,mn=parseInt(time[1])||0;
        switch(task.freq||'daily'){case'daily':return mn+' '+hr+' * * *';case'weekly':return mn+' '+hr+' * * '+(task.dow||'0');case'monthly':return mn+' '+hr+' '+(task.dom||'1')+' * *';default:return mn+' '+hr+' * * *';}
    }

    // ---- In-app scheduler ----
    function startScheduler(){
        if(_schedulerTimer)return;
        _schedulerTimer=setInterval(function(){
            if(!booted)return;
            var now=new Date();var curMin=now.getHours()*60+now.getMinutes();
            if(curMin===_lastScheduleMinute)return;_lastScheduleMinute=curMin;
            (state.scheduledTasks||[]).forEach(function(task){
                if(!task.enabled||task.running)return;
                var expr=getTaskCronExpr(task);
                if(isCronDue(expr,now)){runScheduledTask(task);}
            });
        },15000);
    }

    // ---- Task status helpers ----
    function getTaskStatus(task){
        if(task.running)return{cls:'running',label:t('scheduledRunning')||'扫描中...',color:'var(--accent)'};
        var lr=task.lastRun;if(!lr)return{cls:'idle',label:t('scheduledNeverRun')||'未执行',color:'var(--text-tertiary)'};
        if(lr.status==='error')return{cls:'error',label:t('scanError')||'出错',color:'var(--danger)'};
        if(lr.infectedCount>0)return{cls:'warning',label:t('scanResultInfected'),color:'var(--warning)'};
        return{cls:'success',label:t('scanResultClean'),color:'var(--success)'};
    }

    // ---- Render scheduled list ----
    function renderScheduledList(){
        var list=document.getElementById('scheduledList');var tasks=state.scheduledTasks||[];
        if(!tasks.length){list.innerHTML='<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="empty-text">'+t('scheduledEmpty')+'</div></div>';return;}
        list.innerHTML=tasks.map(function(task){
            var st;if(task.cronMode==='cron'&&task.cron){st=cronToHuman(task.cron)+' <code>'+task.cron+'</code>';}
            else{var fl=t('freq'+task.freq.charAt(0).toUpperCase()+task.freq.slice(1))||task.freq;st=fl;if(task.freq==='weekly'&&task.dow!==undefined)st+=' '+t('dow'+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][parseInt(task.dow)]);if(task.freq==='monthly'&&task.dom)st+=' '+task.dom+'日';st+=' '+(task.time||'03:00');}
            var th=task.threads||4;
            var ts=getTaskStatus(task);
            var dotClass=task.enabled?(task.running?'running':ts.cls):'inactive';
            var progressHtml='';
            if(task.running&&task._progress){
                var pct=task._progress.pct||0;
                progressHtml='<div class="task-progress"><div class="task-progress-bar"><div class="task-progress-fill" style="width:'+pct+'%"></div></div><div class="task-progress-text">'+task._progress.files+' files · '+task._progress.infected+' infected · '+task._progress.elapsed+'s</div></div>';
            }
            var lrHtml='';
            if(task.lastRun&&!task.running){
                var lr=task.lastRun;
                var lrStatus=lr.infectedCount>0?'<span style="color:var(--danger)">⚠ '+lr.infectedCount+'</span>':'<span style="color:var(--success)">✓</span>';
                lrHtml='<div class="task-last-run">'+lrStatus+' '+lr.totalFiles+' '+(t('statFiles')||'文件')+' · '+lr.duration+' · '+new Date(lr.time).toLocaleString()+'</div>';
            }
            var runCount=(task.runs||[]).length;
            var runBadge=runCount>0?'<span class="task-run-badge" onclick="App.showTaskRuns('+task.id+')" title="'+(t('scheduledRunHistory')||'运行记录')+'">'+runCount+'</span>':'';
            return'<div class="scheduled-task-card'+(task.running?' running':'')+'"><div class="task-header"><div class="svc-dot '+dotClass+'"></div><div class="task-info"><div class="task-name">'+task.name+runBadge+'</div><div class="task-schedule">'+st+' · '+th+'线程 · <code>'+task.paths+'</code></div></div><div class="task-status" style="color:'+ts.color+'">'+ts.label+'</div></div>'+progressHtml+lrHtml+'<div class="task-actions"><button class="btn btn-sm btn-secondary" onclick="App.toggleScheduledTask('+task.id+')">'+(task.enabled?(t('btnDisable')||'停用'):(t('btnEnable')||'启用'))+'</button><button class="btn btn-sm btn-secondary" onclick="App.editScheduled('+task.id+')">'+(t('btnEdit')||'编辑')+'</button><button class="btn btn-sm '+(task.running?'btn-danger':'btn-secondary')+'" onclick="App.'+(task.running?'stopScheduledTask':'runScheduledNow')+'('+task.id+')">'+(task.running?(t('scanStop')||'停止扫描'):(t('scheduledRunNow')||'立即执行'))+'</button><button class="btn btn-sm btn-danger" onclick="App.deleteScheduled('+task.id+')">'+(t('btnDelete')||'删除')+'</button></div></div>';
        }).join('');
    }

    // ---- Scheduled scan execution (headless, no DOM dependency) ----
    function doScheduledScan(task,paths,excludeDirs,numThreads,onProgress,onDone,onError){
        var scanner='clamscan';
        var excludeFlags=excludeDirs.map(function(d){return'--exclude-dir='+d;}).join(' ');
        var totalFiles=0,infectedCount=0,fileCount=0,infected=[],startTime=Date.now();
        var procs=[],pids=[];task._procs=procs;task._pids=pids;task._cancelled=false;task._killed=false;
        function killAll(){
            if(task._killed)return;task._killed=true;task._cancelled=true;
            try{cockpit.spawn(['bash','-c','pkill -f clamscan 2>/dev/null; sleep 0.2; pkill -9 -f clamscan 2>/dev/null; true'],{err:'ignore'});}catch(e){}
            procs.forEach(function(p){try{p.close();}catch(e){}});procs=[];pids=[];
        }
        task._kill=killAll;
        function onFileScanned(isInf,path,virus){fileCount++;if(isInf){infectedCount++;infected.push({path:path,virus:virus});}if(onProgress)onProgress({files:fileCount,infected:infectedCount,elapsed:((Date.now()-startTime)/1000).toFixed(0),pct:0});}
        function onStats(total){if(total>totalFiles)totalFiles=total;}
        function scanOnePath(scanPath){
            var safePath=scanPath.replace(/[^a-zA-Z0-9\/\.\-\_]/g,'');
            if(!safePath||safePath!==scanPath)return Promise.resolve();
            var args=[scanner,'-r','--verbose'];
            if(excludeFlags)excludeFlags.split(' ').filter(Boolean).forEach(function(f){args.push(f);});
            args.push(safePath);
            return new Promise(function(resolve,reject){
                var proc=cockpit.spawn(args,{err:'out'});procs.push(proc);
                var ch=proc.channel||proc;if(ch&&ch.addEventListener)ch.addEventListener('spawn',function(ev,pid){if(pid)pids.push(pid);});
                var buffer='';proc.stream(function(data){if(task._cancelled)return;buffer+=data;var lines=buffer.split('\n');buffer=lines.pop();lines.forEach(function(line){line=line.trim();if(!line)return;if(line.endsWith(' FOUND')){var idx=line.lastIndexOf(': ');onFileScanned(true,line.substring(0,idx),line.substring(idx+2).replace(' FOUND',''));}else if(line.endsWith(' OK')){onFileScanned(false,line.replace(' OK',''),null);}else if(line.match(/Scanned files:\s+(\d+)/)){onStats(parseInt(line.match(/Scanned files:\s+(\d+)/)[1]));}});});
                proc.done(function(){if(task._cancelled)return;if(buffer.trim()){var l=buffer.trim();if(l.endsWith(' OK'))onFileScanned(false,l.replace(' OK',''),null);else if(l.endsWith(' FOUND')){var i2=l.lastIndexOf(': ');onFileScanned(true,l.substring(0,i2),l.substring(i2+2).replace(' FOUND',''));}}resolve();});
                proc.fail(function(ex){if(task._cancelled)resolve();else reject(ex);});
            });
        }
        B.spawn(['which',scanner]).then(function(){
            var bs=Math.min(numThreads,paths.length);
            var idx=0;
            function nextBatch(){if(idx>=paths.length)return Promise.resolve();var batch=paths.slice(idx,idx+bs);idx+=bs;return Promise.all(batch.map(function(p){return scanOnePath(p);})).then(nextBatch);}
            return nextBatch();
        }).then(function(){
            var elapsed=((Date.now()-startTime)/1000).toFixed(1);
            if(!totalFiles)totalFiles=fileCount;
            var record={time:new Date().toISOString(),target:task.name,paths:paths.join(','),scanner:scanner,totalFiles:totalFiles,infectedCount:infectedCount,duration:elapsed+'s'};
            state.scanHistory.unshift(record);if(state.scanHistory.length>50)state.scanHistory=state.scanHistory.slice(0,50);
            state.totalScanned+=totalFiles;state.lastScanTime=record.time;state.lastDuration=elapsed+'s';
            infected.forEach(function(item){if(!state.quarantineItems.find(function(q){return q.path===item.path;}))state.quarantineItems.push({id:Date.now()+Math.random(),path:item.path,virus:item.virus,date:new Date().toISOString()});});
            if(infectedCount>0)state.totalInfected+=infectedCount;
            if(onDone)onDone({totalFiles:totalFiles,infectedCount:infectedCount,duration:elapsed,infected:infected});
        }).catch(function(e){
            killAll();
            if(task._cancelled){
                // Task was explicitly stopped — do not call onDone to avoid race with stopScheduledTask
                var elapsed=((Date.now()-startTime)/1000).toFixed(1);
                if(!totalFiles)totalFiles=fileCount;
                var record={time:new Date().toISOString(),target:task.name,paths:paths.join(','),scanner:scanner,totalFiles:totalFiles,infectedCount:infectedCount,duration:elapsed+'s'};
                state.scanHistory.unshift(record);if(state.scanHistory.length>50)state.scanHistory=state.scanHistory.slice(0,50);
                state.totalScanned+=totalFiles;state.lastScanTime=record.time;state.lastDuration=elapsed+'s';
                infected.forEach(function(item){if(!state.quarantineItems.find(function(q){return q.path===item.path;}))state.quarantineItems.push({id:Date.now()+Math.random(),path:item.path,virus:item.virus,date:new Date().toISOString()});});
                if(infectedCount>0)state.totalInfected+=infectedCount;
                updateDashboardStats();renderQuarantine();renderHistory();saveState();
            } else if(onError)onError(e.message||e.problem||String(e));
        });
    }

    // ---- Run a scheduled task ----
    function runScheduledTask(task){
        if(task.running||!assertReady())return;
        var paths=task.paths.split(',').map(function(s){return s.trim();}).filter(Boolean);
        var excludeDirs=task.exclude?task.exclude.split(',').map(function(s){return s.trim();}).filter(Boolean):[];
        var numThreads=task.threads||4;
        task.running=true;task._progress={files:0,infected:0,elapsed:'0',pct:0};
        var runRecord={time:new Date().toISOString(),taskId:task.id,taskName:task.name,status:'running'};
        renderScheduledList();addNotif('notifScanComplete');
        doScheduledScan(task,paths,excludeDirs,numThreads,
            function(prog){task._progress=prog;renderScheduledList();},
            function(result){
                task.running=false;task._progress=null;
                runRecord.status=result.infectedCount>0?'warning':'success';
                runRecord.totalFiles=result.totalFiles;runRecord.infectedCount=result.infectedCount;runRecord.duration=result.duration+'s';
                runRecord.infectedList=result.infected;
                task.lastRun={time:runRecord.time,status:runRecord.status,totalFiles:result.totalFiles,infectedCount:result.infectedCount,duration:result.duration+'s'};
                if(!task.runs)task.runs=[];task.runs.unshift(runRecord);if(task.runs.length>20)task.runs=task.runs.slice(0,20);
                updateDashboardStats();renderQuarantine();renderHistory();renderScheduledList();saveState();
                if(result.infectedCount>0){showToast(task.name+': '+result.infectedCount+' '+(t('scanResultInfected')||'威胁'),'warning',6);addNotif('notifThreatDetected');}
                else{showToast(task.name+': '+(t('scanResultClean')||'安全')+' ('+result.totalFiles+' files, '+result.duration+'s)','success',4);}
                writeScanLog({target:task.name,totalFiles:result.totalFiles,infectedCount:result.infectedCount,duration:result.duration,scanner:'clamscan',infectedList:result.infected});
            },
            function(err){
                task.running=false;task._progress=null;
                runRecord.status='error';runRecord.error=err;
                task.lastRun={time:runRecord.time,status:'error',totalFiles:0,infectedCount:0,duration:'--'};
                if(!task.runs)task.runs=[];task.runs.unshift(runRecord);if(task.runs.length>20)task.runs=task.runs.slice(0,20);
                renderScheduledList();saveState();
                showToast(task.name+': '+(t('scanError')||'扫描出错'),'error',6);
            }
        );
    }

    // ---- Task run history modal ----
    function showTaskRuns(taskId){
        var task=(state.scheduledTasks||[]).find(function(t2){return t2.id===taskId;});
        if(!task||!task.runs||!task.runs.length){showToast(t('scheduledNoRuns')||'暂无运行记录','info');return;}
        var html=task.runs.slice(0,10).map(function(r){
            var statusCls=r.status==='success'?'success':(r.status==='warning'?'warning':'danger');
            var statusLabel=r.status==='success'?(t('scanResultClean')||'安全'):(r.status==='warning'?(r.infectedCount+' '+(t('scanResultInfected')||'威胁')):(t('scanError')||'出错'));
            return'<div class="task-run-item"><div class="run-status"><span class="status-badge '+statusCls+'">'+statusLabel+'</span></div><div class="run-detail">'+(r.totalFiles||0)+' '+(t('statFiles')||'文件')+(r.duration?' · '+r.duration:'')+'</div><div class="run-time">'+new Date(r.time).toLocaleString()+'</div></div>';
        }).join('');
        var overlay=document.getElementById('confirmOverlay');
        document.getElementById('confirmTitle').textContent=task.name+' — '+(t('scheduledRunHistory')||'运行记录');
        document.getElementById('confirmMsg').innerHTML='<div style="max-height:300px;overflow-y:auto;">'+html+'</div>';
        document.getElementById('confirmBtn').textContent=t('btnClose')||'关闭';
        document.getElementById('confirmBtn').className='btn btn-secondary';
        overlay.classList.add('show');document.body.style.overflow='hidden';
    }

    // ---- Install cron for system-level (kept for backward compat, no longer primary) ----
    function installCronForTasks(){}
    function showAddScheduled(){
        editingTaskId=null;
        var overlay=document.getElementById('scheduledEditOverlay');
        var nameInput=document.getElementById('schedEditName');
        var pathsInput=document.getElementById('schedEditPaths');
        var excludeInput=document.getElementById('schedEditExclude');
        var cronInput=document.getElementById('schedEditCron');
        var timeInput=document.getElementById('schedEditTime');
        var domInput=document.getElementById('schedEditDom');
        document.getElementById('scheduledEditTitle').textContent=t('scheduledAddTask')||'添加定时扫描';
        nameInput.value='';
        pathsInput.value='/etc,/tmp,/var,/home';
        excludeInput.value='';
        cronInput.value='';
        timeInput.value='03:00';
        domInput.value='1';
        try{setCSVal('schedEditCronMode','simple');}catch(e){}
        try{setCSVal('schedEditFreq','daily');}catch(e){}
        try{setCSVal('schedEditDow','1');}catch(e){}
        try{setCSVal('schedEditThreads','4');}catch(e){}
        document.getElementById('schedSimpleFields').style.display='';
        document.getElementById('schedCronFields').style.display='none';
        document.getElementById('schedDowGroup').style.display='none';
        document.getElementById('schedDomGroup').style.display='none';
        overlay.classList.add('show');document.body.style.overflow='hidden';
        setTimeout(function(){pathsInput.focus();},100);
    }
    function editScheduled(id){
        var task=(state.scheduledTasks||[]).find(function(t2){return t2.id===id;});if(!task)return;
        editingTaskId=id;document.getElementById('scheduledEditTitle').textContent=t('scheduledEditTask')||'编辑定时扫描';
        document.getElementById('schedEditName').value=task.name;setCSVal('schedEditCronMode',task.cronMode||'simple');
        setCSVal('schedEditFreq',task.freq||'daily');setCSVal('schedEditDow',String(task.dow||'1'));
        document.getElementById('schedEditDom').value=task.dom||'1';
        document.getElementById('schedEditTime').value=task.time||'03:00';document.getElementById('schedEditCron').value=task.cron||'';
        document.getElementById('schedEditPaths').value=task.paths;document.getElementById('schedEditExclude').value=task.exclude||'';
        setCSVal('schedEditThreads',String(task.threads||4));
        document.getElementById('schedSimpleFields').style.display=(task.cronMode==='cron')?'none':'';
        document.getElementById('schedCronFields').style.display=(task.cronMode==='cron')?'':'none';
        document.getElementById('schedDowGroup').style.display=(task.freq==='weekly')?'':'none';
        document.getElementById('schedDomGroup').style.display=(task.freq==='monthly')?'':'none';
        document.getElementById('scheduledEditOverlay').classList.add('show');document.body.style.overflow='hidden';
    }
    function closeScheduledEdit(){document.getElementById('scheduledEditOverlay').classList.remove('show');document.body.style.overflow='';document.querySelectorAll('.custom-select.open').forEach(function(c){c.classList.remove('open');});}
    function saveScheduledEdit(){
        var name=document.getElementById('schedEditName').value.trim()||'扫描任务';
        var cronMode=getCSVal('schedEditCronMode')||'simple';
        var freq=getCSVal('schedEditFreq')||'daily';
        var dow=getCSVal('schedEditDow')||'1';
        var dom=parseInt(document.getElementById('schedEditDom').value)||1;
        var time=document.getElementById('schedEditTime').value||'03:00';
        var cron=document.getElementById('schedEditCron').value.trim();
        var paths=document.getElementById('schedEditPaths').value.trim();
        var exclude=document.getElementById('schedEditExclude').value.trim();
        var threads=parseInt(getCSVal('schedEditThreads'))||4;
        if(!paths){showToast(t('scanNoPath')||'请输入路径','warning');return;}
        if(cronMode==='cron'&&!cron){showToast(t('cronExprLabel')||'请输入Cron表达式','warning');return;}
        if(!state.scheduledTasks)state.scheduledTasks=[];
        var taskData={name:name,cronMode:cronMode,freq:freq,dow:dow,dom:dom,time:time,cron:cron,paths:paths,exclude:exclude,threads:threads};
        if(editingTaskId){var task=state.scheduledTasks.find(function(t2){return t2.id===editingTaskId;});if(task)Object.assign(task,taskData);}
        else{state.scheduledTasks.push(Object.assign({id:Date.now(),enabled:true,running:false,lastRun:null,runs:[]},taskData));}
        saveState();renderScheduledList();closeScheduledEdit();showToast(t('toastSettingsSaved'),'success');
    }
    async function deleteScheduled(id){var ok=await openConfirm(t('scheduledDeleteConfirm')||'删除',t('scheduledDeleteMsg')||'确定？');if(!ok)return;state.scheduledTasks=(state.scheduledTasks||[]).filter(function(t2){return t2.id!==id;});saveState();renderScheduledList();showToast(t('toastOperationSuccess'),'success');}
    function toggleScheduledTask(id){var task=(state.scheduledTasks||[]).find(function(t2){return t2.id===id;});if(!task)return;task.enabled=!task.enabled;saveState();renderScheduledList();}
    function runScheduledNow(id){var task=(state.scheduledTasks||[]).find(function(t2){return t2.id===id;});if(!task)return;if(task.running){showToast(t('scheduledAlreadyRunning')||'任务正在执行中','warning');return;}runScheduledTask(task);}
    function stopScheduledTask(id){var task=(state.scheduledTasks||[]).find(function(t2){return t2.id===id;});if(!task||!task.running)return;task._cancelled=true;if(task._kill)task._kill();task.running=false;task._progress=null;renderScheduledList();saveState();showToast(task.name+': '+(t('scanStopped')||'扫描已停止'),'warning');}

    // ==================== ClamAV Config Editor ====================
    var CLAMD_CONF='/etc/clamav/clamd.conf';
    async function reloadClamdConf(){
        var editor=document.getElementById('clamdConfEditor');
        try{
            var f=cockpit.file(CLAMD_CONF,{superuser:'try'});
            var content=await f.read();
            f.close();
            if(content===null||content===undefined){editor.value='';showToast(t('configNotFound')||'配置文件不存在','warning',3);return;}
            editor.value=content;
            showToast(t('toastOperationSuccess')||'已加载','success',2);
        }catch(e){editor.value='# '+CLAMD_CONF+' not found\n# Install: apt install clamav clamav-daemon';showToast(t('configNotFound')||'配置文件不存在','warning',3);}
    }
    async function saveClamdConf(){
        var editor=document.getElementById('clamdConfEditor');var content=editor.value;
        try{
            var f=cockpit.file(CLAMD_CONF,{superuser:'try'});
            await f.replace(content);
            f.close();
            showToast(t('configSaved')||'配置已保存','success');
        }catch(e){showToast(t('toastOperationFailed'),'error');}
    }
    async function restartClamd(){
        try{await SVC.restart('clamav-daemon.service');showToast(t('configRestarted')||'ClamAV 已重启','success');await refreshStatus();syncRealtimeStatus();}
        catch(e){showToast(t('toastOperationFailed')+': '+(e.message||e),'error');}
    }

    // ==================== Definitions ====================
    function isFreshclamFailed(output) {
        if (!output) return false;
        var failPatterns = ['error code 429','error code 403','rate limit','blocked','cool-down','FAILED','not up-to-date','can\'t connect','Can\'t connect'];
        for (var i=0;i<failPatterns.length;i++) { if (output.indexOf(failPatterns[i])!==-1) return true; }
        // If no "is up to date" or "updated" found, and has WARNING, treat as failure
        if (output.indexOf('WARNING')!==-1 && output.indexOf('is up to date')===-1 && output.indexOf('updated')===-1 && output.indexOf('Updated')===-1) return true;
        return false;
    }

    async function checkDefStatus(){
        if(!assertReady())return;
        var btn=document.getElementById('defCheckBtn');var span=btn?btn.querySelector('span'):null;
        if(btn)btn.disabled=true;if(span)span.textContent=t('loading')||'检查中...';
        var version='--',totalSigs='--',lastUpdate='--';
        try{var out=await B.spawn(['clamconf']);out.split('\n').forEach(function(l){l=l.trim();if(l.startsWith('Engine version:'))version=l.split(':').slice(1).join(':').trim();if(l.startsWith('Daily database version:')){var v=l.split(':')[1].trim();if(v&&v!=='0')version='Daily '+v;}if(l.startsWith('Total sigs:'))totalSigs=l.split(':')[1].trim();if(l.startsWith('Last update:'))lastUpdate=l.split(':').slice(1).join(':').trim();});if(version!=='--'){document.getElementById('defVersion').textContent=version;document.getElementById('defLastUpdate').textContent=lastUpdate;document.getElementById('defTotalSigs').textContent=totalSigs;document.getElementById('statDefVersion').textContent=version;if(btn){btn.disabled=false;span.textContent=t('defCheckStatus');}showToast(t('toastOperationSuccess')||'完成','success',2);return;}}catch(e){}
        try{var fv=await B.spawn(['freshclam','--version']);var fvl=fv.trim().split('\n');if(fvl.length){var vm=fvl[fvl.length-1].match(/ClamAV\s+([\d.]+)/);if(vm)version=vm[1];}}catch(e){}
        try{var cvdInfo=await B.spawn(['bash','-c','sigtool --info /var/lib/clamav/daily.cvd 2>/dev/null || sigtool --info /var/lib/clamav/daily.cld 2>/dev/null || echo "no_sigtool"']);cvdInfo.split('\n').forEach(function(l){l=l.trim();if(l.match(/Version:\s+(\d+)/)){var v=l.match(/Version:\s+(\d+)/)[1];if(v!=='0')version='Daily '+v;}if(l.match(/Signatures:\s+(\d+)/))totalSigs=l.match(/Signatures:\s+(\d+)/)[1];if(l.match(/Build time:\s+(.+)/))lastUpdate=l.match(/Build time:\s+(.+)/)[1].trim();});}catch(e){}
        if(lastUpdate==='--'){try{var so=await B.spawn(['bash','-c','stat -c "%y" /var/lib/clamav/daily.cvd 2>/dev/null || stat -c "%y" /var/lib/clamav/daily.cld 2>/dev/null || echo "--"']);if(so.trim()&&so.trim()!=='--')lastUpdate=so.trim().substring(0,19);}catch(e){}}
        document.getElementById('defVersion').textContent=version;document.getElementById('defLastUpdate').textContent=lastUpdate;document.getElementById('defTotalSigs').textContent=totalSigs;document.getElementById('statDefVersion').textContent=version;
        if(btn){btn.disabled=false;}if(span){span.textContent=t('defCheckStatus');}
        if(version==='--'&&totalSigs==='--')showToast(t('defCheckFailed')||'未找到病毒库信息','warning',4);else showToast(t('toastOperationSuccess')||'完成','success',2);
    }
    async function updateDefinitions(){
        if(!assertReady())return;
        var btn=document.getElementById('defUpdateBtn'),outputArea=document.getElementById('defUpdateOutput'),logEl=document.getElementById('defUpdateLog'),span=btn.querySelector('span');
        btn.disabled=true;span.textContent=t('defUpdating');outputArea.style.display='';logEl.textContent=t('defUpdating')+'\n';
        try{
            try{await SVC.stop('clamav-freshclam.service');}catch(e){}
            await new Promise(function(r){setTimeout(r,1000);});
            var out=await B.spawnSuper(['freshclam','--stdout','--no-dns']);
            logEl.textContent+=out||'(completed)';
            if(isFreshclamFailed(out)){
                showToast(t('defUpdateFailed'),'error');
                logEl.textContent+='\n---\n'+t('defUpdateFailed')+'\n';
            }else{
                showToast(t('defUpdateSuccess'),'success');addNotif('notifDefUpdated');await checkDefStatus();
            }
            try{await SVC.start('clamav-freshclam.service');}catch(e){}
        }catch(e){
            var errMsg=e.message||e.problem||(typeof e==='string'?e:JSON.stringify(e));
            logEl.textContent+='\nERROR: '+errMsg;
            logEl.textContent+='\n\n尝试备用方式...\n';
            try{
                var altOut=await B.spawnSuper(['bash','-c','cvd update 2>&1 || freshclam 2>&1']);
                logEl.textContent+=altOut||'(completed)';
                if(isFreshclamFailed(altOut)){
                    showToast(t('defUpdateFailed'),'error');
                    logEl.textContent+='\n---\n'+t('defUpdateFailed')+'\n';
                }else{
                    showToast(t('defUpdateSuccess'),'success');addNotif('notifDefUpdated');await checkDefStatus();
                }
            }catch(e2){
                logEl.textContent+='\n备用失败: '+(e2.message||e2.problem||e2);showToast(t('defUpdateFailed'),'error');
            }
        }finally{btn.disabled=false;span.textContent=t('defUpdateBtn');}
    }

    // ==================== Quarantine ====================
    function renderQuarantine(){var list=document.getElementById('quarantineList'),btn=document.getElementById('quarantineDeleteAllBtn');if(!state.quarantineItems.length){list.innerHTML='<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div><div class="empty-text">'+t('quarantineEmpty')+'</div></div>';btn.style.display='none';return;}btn.style.display='';list.innerHTML=state.quarantineItems.map(function(i){return'<div class="quarantine-item" data-id="'+i.id+'"><div class="q-info"><div class="q-name">'+i.path+'</div><div class="q-meta">'+i.virus+' · '+new Date(i.date).toLocaleString()+'</div></div><div class="q-actions"><button class="btn btn-sm btn-secondary" onclick="App.restoreQuarantine(\''+i.id+'\')">'+t('quarantineRestore')+'</button><button class="btn btn-sm btn-danger" onclick="App.deleteQuarantineItem(\''+i.id+'\')">'+t('quarantineDelete')+'</button></div></div>';}).join('');}
    async function restoreQuarantine(id){state.quarantineItems=state.quarantineItems.filter(function(q){return String(q.id)!==String(id);});state.totalInfected=Math.max(0,state.totalInfected-1);updateDashboardStats();renderQuarantine();saveState();showToast(t('quarantineRestored'),'success');}
    async function deleteQuarantineItem(id){var ok=await openConfirm(t('quarantineDeleteConfirm'),t('quarantineDeleteMsg'));if(!ok)return;state.quarantineItems=state.quarantineItems.filter(function(q){return String(q.id)!==String(id);});state.totalInfected=Math.max(0,state.totalInfected-1);updateDashboardStats();renderQuarantine();saveState();showToast(t('quarantineDeleted'),'success');}
    async function deleteAllQuarantine(){var ok=await openConfirm(t('quarantineDeleteConfirm'),t('quarantineDeleteAllMsg'));if(!ok)return;state.quarantineItems=[];state.totalInfected=0;updateDashboardStats();renderQuarantine();saveState();showToast(t('quarantineAllDeleted'),'success');}
    function refreshQuarantine(){renderQuarantine();showToast(t('toastOperationSuccess'),'success',2);}

    // ==================== Dashboard ====================
    function updateDashboardStats(){
        document.getElementById('statClean').textContent=state.totalScanned.toLocaleString();
        document.getElementById('statInfected').textContent=state.totalInfected;
        document.getElementById('statQuarantine').textContent=state.quarantineItems.length;
        document.getElementById('statLastScan').textContent=state.lastScanTime?new Date(state.lastScanTime).toLocaleString():t('statNever');
        document.getElementById('statScanCount').textContent=state.scanHistory?state.scanHistory.length:0;
        document.getElementById('statLastDuration').textContent=state.lastDuration||'--';
        document.getElementById('statRealtime').textContent=state.realtimeEnabled?t('svcActive'):t('svcInactive');
    }
    function clearScanLog(){try{var el=document.getElementById('scanLogContent');if(el)el.innerHTML='';}catch(e){}}

    // ==================== Init ====================
    async function init(){
        loadState();await loadSettingsFromFile();
        // Migrate existing scheduled tasks
        (state.scheduledTasks||[]).forEach(function(task){
            if(task.running===undefined)task.running=false;
            if(!task.lastRun&&task.lastRun!==null)task.lastRun=null;
            if(!task.runs)task.runs=[];
        });
        currentLang=state.lang;$html.lang=currentLang;
        await loadLang('zh-CN');await loadLang('en');
        updateAllI18n();applyTheme(state.theme);applyAccentColor(state.accentColor);
        buildMenus();setActiveMenu('dashboard');
        applyMenuLayout(state.menuLayout||'side');
        if(window.innerWidth<=768){$sidebar.classList.add('collapsed');state.sidebarOpen=false;}
        setCSVal('settingTheme',state.theme);setCSVal('settingLang',state.lang);setCSVal('settingMenuLayout',state.menuLayout||'side');
        document.getElementById('settingToastDuration').value=state.toastDuration;document.getElementById('settingLogRetention').value=state.logRetentionDays||30;
        setCSVal('scanThreads',String(state.scanThreads||4));
        document.getElementById('scanExclude').value=state.scanExclude||'/proc,/sys,/dev';
        initCustomSelects();updateNotifBadge();renderNotifPanel();
        updateDashboardStats();syncRealtimeStatus();renderQuarantine();renderHistory();renderScheduledList();
        SVC.onChange(function(){refreshStatus();syncRealtimeStatus();});
        await refreshStatus();await checkDefStatus();
        startScheduler();
        bindEvents();
        document.getElementById('scheduledEditOverlay').addEventListener('click',function(e){e.stopPropagation();});
    }
    function bindEvents(){
        $hamburgerBtn.addEventListener('click',toggleSidebar);$sidebarOverlay.addEventListener('click',closeMobileSidebar);
        document.getElementById('themeBtn').addEventListener('click',toggleTheme);document.getElementById('menuLayoutBtn').addEventListener('click',toggleMenuLayout);
        document.getElementById('settingsBtn').addEventListener('click',openSettings);$settingsOverlay.addEventListener('click',function(e){e.stopPropagation();});
        function posNotif(){var r=document.getElementById('notifBtn').getBoundingClientRect();$notifPanel.style.top=(r.bottom+8)+'px';$notifPanel.style.right=(window.innerWidth-r.right)+'px';}
        document.getElementById('notifBtn').addEventListener('click',function(e){e.stopPropagation();var w=!$notifPanel.classList.contains('show');closePopups();if(w){posNotif();$notifPanel.classList.add('show');}});
        document.getElementById('clearNotifBtn').addEventListener('click',function(e){e.stopPropagation();notifItems=[];updateNotifBadge();renderNotifPanel();});
        var $langBtn=document.getElementById('langBtn'),$langDD=document.getElementById('langDropdown');
        $langBtn.addEventListener('click',function(e){e.stopPropagation();var w=!$langDD.classList.contains('show');closePopups();if(w){var r=$langBtn.getBoundingClientRect();$langDD.style.top=(r.bottom+8)+'px';$langDD.style.right=(window.innerWidth-r.right)+'px';$langDD.classList.add('show');}});
        $langDD.querySelectorAll('.lang-dropdown-item').forEach(function(el){el.addEventListener('click',function(){state.lang=el.dataset.lang;currentLang=state.lang;$html.lang=currentLang;updateAllI18n();buildMenus();setActiveMenu(document.querySelector('.menu-item.active')?document.querySelector('.menu-item.active').dataset.menuId:'dashboard');setCSVal('settingLang',currentLang);document.querySelectorAll('.lang-dropdown-item').forEach(function(i){i.classList.toggle('active',i.dataset.lang===currentLang);});refreshStatus();syncRealtimeStatus();updateDashboardStats();renderQuarantine();renderHistory();renderScheduledList();$langDD.classList.remove('show');saveState();showToast(t('toastLangChanged'),'success',2.5);});});
        document.getElementById('realtimeToggle').addEventListener('change',function(){toggleRealtime(this.checked);});
        document.querySelectorAll('.color-swatch').forEach(function(el){el.addEventListener('click',function(){applyAccentColor(el.dataset.color);});});
        function closePopups(){$notifPanel.classList.remove('show');document.getElementById('langDropdown').classList.remove('show');}
        document.addEventListener('click',function(e){if(!$notifPanel.contains(e.target)&&!document.getElementById('notifBtn').contains(e.target)&&!document.getElementById('langDropdown').contains(e.target)&&!document.getElementById('langBtn').contains(e.target))closePopups();});
        document.addEventListener('keydown',function(e){if(e.key==='Escape'){closeConfirm(false);closeSettings();closeScheduledEdit();if(state.mobileSidebarOpen)closeMobileSidebar();closePopups();}});
        var wasM=window.innerWidth<=768;window.addEventListener('resize',function(){var isM=window.innerWidth<=768;if(isM!==wasM){$sidebar.classList.add('resizing');setTimeout(function(){if(!isM){closeMobileSidebar();if(state.sidebarOpen)$sidebar.classList.remove('collapsed');}else{$sidebar.classList.add('collapsed');state.mobileSidebarOpen=false;}$body.classList.toggle('sidebar-collapsed',$sidebar.classList.contains('collapsed'));wasM=isM;requestAnimationFrame(function(){$sidebar.classList.remove('resizing');});},150);}});
    }

    // ==================== Global API ====================
    window.App = {
        showToast:showToast,t:t,
        navigateTo:function(id){setActiveMenu(id);if(window.innerWidth<=768)closeMobileSidebar();},
        startCustomScan:startCustomScan,scanPreset:scanPreset,scanMemory:scanMemory,stopScan:stopScan,clearScanLog:clearScanLog,
        checkDefStatus:checkDefStatus,updateDefinitions:updateDefinitions,
        restoreQuarantine:restoreQuarantine,deleteQuarantineItem:deleteQuarantineItem,deleteAllQuarantine:deleteAllQuarantine,refreshQuarantine:refreshQuarantine,
        refreshStatus:refreshStatus,toggleRealtime:toggleRealtime,
        startAllServices:startAllServices,stopAllServices:stopAllServices,restartAllServices:restartAllServices,
        showAddScheduled:showAddScheduled,editScheduled:editScheduled,saveScheduledEdit:saveScheduledEdit,closeScheduledEdit:closeScheduledEdit,
        deleteScheduled:deleteScheduled,toggleScheduledTask:toggleScheduledTask,runScheduledNow:runScheduledNow,stopScheduledTask:stopScheduledTask,showTaskRuns:showTaskRuns,
        reloadClamdConf:reloadClamdConf,saveClamdConf:saveClamdConf,restartClamd:restartClamd,
        openSettings:openSettings,closeSettings:closeSettings,saveSettingsFromPanel:saveSettingsFromPanel,resetSettings:resetSettings,
        openConfirm:openConfirm,closeConfirm:closeConfirm,
        refreshHistory:refreshHistory,clearHistory:clearHistory,
    };
})();

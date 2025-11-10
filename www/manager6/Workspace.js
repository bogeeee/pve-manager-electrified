/*
 * Workspace base class
 *
 * popup login window when auth fails (call onLogin handler)
 * update (re-login) ticket every 15 minutes
 *
 */

Ext.define('PVE.Workspace', {
    extend: 'Ext.container.Viewport',

    title: 'Proxmox Virtual Environment',

    loginData: null, // Data from last login call

    onLogin: function(loginData) {
	// override me
    },

    // private
    updateLoginData: function(loginData) {
	let me = this;
	me.loginData = loginData;
	Proxmox.Utils.setAuthData(loginData);

	let rt = me.down('pveResourceTree');
	rt.setDatacenterText(loginData.clustername);
	PVE.ClusterName = loginData.clustername;

	if (loginData.cap) {
	    Ext.state.Manager.set('GuiCap', loginData.cap);
	}
	me.response401count = 0;

	me.onLogin(loginData);
	window.electrifiedApp.onLogin(loginData);
    },

    // private
    showLogin: function() {
	let me = this;

	Proxmox.Utils.authClear();
	Ext.state.Manager.clear('GuiCap');
	Proxmox.UserName = null;
	me.loginData = null;

	if (!me.login) {
	    me.login = Ext.create('PVE.window.LoginWindow', {
		handler: function(data) {
		    me.login = null;
		    me.updateLoginData(data);
		    //Proxmox.Utils.checked_command(Ext.emptyFn); // display subscription status
		},
	    });
	}
	me.onLogin(null);
        me.login.show();
    },

    initComponent: function() {
	let me = this;

	Ext.tip.QuickTipManager.init();

	// fixme: what about other errors
	Ext.Ajax.on('requestexception', function(conn, response, options) {
	    if ((response.status === 401 || response.status === '401') && !PVE.Utils.silenceAuthFailures) { // auth failure
		// don't immediately show as logged out to cope better with some big
		// upgrades, which may temporarily produce a false positive 401 err
		me.response401count++;
		if (me.response401count > 5) {
		    me.showLogin();
		}
	    }
	});

	me.callParent();

        if (!Proxmox.Utils.authOK()) {
	    me.showLogin();
	} else if (me.loginData) {
	    me.onLogin(me.loginData);
	}

	Ext.TaskManager.start({
	    run: function() {
		let ticket = Proxmox.Utils.authOK();
		if (!ticket || !Proxmox.UserName) {
		    return;
		}

		Ext.Ajax.request({
		    params: {
			username: Proxmox.UserName,
			password: ticket,
		    },
		    url: '/api2/json/access/ticket',
		    method: 'POST',
		    success: function(response, opts) {
			let obj = Ext.decode(response.responseText);
			me.updateLoginData(obj.data);
		    },
		});
	    },
	    interval: 15 * 60 * 1000,
	});
    },
});

Ext.define('PVE.StdWorkspace', {
    extend: 'PVE.Workspace',

    alias: ['widget.pveStdWorkspace'],

    // private
    setContent: function(comp) {
	let me = this;

	let view = me.child('#content');
	let layout = view.getLayout();
	let current = layout.getActiveItem();

	if (comp) {
	    Proxmox.Utils.setErrorMask(view, false);
	    comp.border = false;
	    view.add(comp);
	    if (current !== null && layout.getNext()) {
		layout.next();
		let task = Ext.create('Ext.util.DelayedTask', function() {
		    view.remove(current);
		});
		task.delay(10);
	    }
	} else {
	    view.removeAll(); // helper for cleaning the content when logging out
	}
    },

    selectById: function(nodeid) {
	let me = this;
	me.down('pveResourceTree').selectById(nodeid);
    },

    onLogin: function(loginData) {
	let me = this;

	me.updateUserInfo();

	if (loginData) {
	    PVE.data.ResourceStore.startUpdate();

	    Proxmox.Utils.API2Request({
		url: '/version',
		method: 'GET',
		success: function(response) {
		    PVE.VersionInfo = response.result.data;
		    me.updateVersionInfo();
		},
	    });

	    PVE.UIOptions.update();

	    Proxmox.Utils.API2Request({
		url: '/cluster/sdn',
		method: 'GET',
		success: function(response) {
		    PVE.SDNInfo = response.result.data;
		},
		failure: function(response) {
		    PVE.SDNInfo = null;
		    let ui = Ext.ComponentQuery.query('treelistitem[text="SDN"]')[0];
		    if (ui) {
			ui.addCls('x-hidden-display');
		    }
		},
	    });

	    Proxmox.Utils.API2Request({
		url: '/access/domains',
		method: 'GET',
		success: function(response) {
		    let [_username, realm] = Proxmox.Utils.parse_userid(Proxmox.UserName);
		    response.result.data.forEach((domain) => {
			if (domain.realm === realm) {
			    let schema = PVE.Utils.authSchema[domain.type];
			    if (schema) {
				me.query('#tfaitem')[0].setHidden(!schema.tfa);
				me.query('#passworditem')[0].setHidden(!schema.pwchange);
			    }
			}
		    });
		},
	    });
	}
    },

    updateUserInfo: function() {
	let me = this;
	let ui = me.query('#userinfo')[0];
	ui.setText(Ext.String.htmlEncode(Proxmox.UserName || ''));
	ui.updateLayout();
    },

    updateVersionInfo: function() {
	let me = this;

	let ui = me.query('#versioninfo')[0];

	if (PVE.VersionInfo) {
	    let version = PVE.VersionInfo.version;
	    ui.update('PVE electrified ' + version);
	} else {
	    ui.update('PVE electrified');
	}
	ui.updateLayout();
    },

    initComponent: function() {
	let me = this;

	// Register:
    window.electrifiedApp.workspace = this;

	Ext.History.init();

	let appState = Ext.create('PVE.StateProvider');
	Ext.state.Manager.setProvider(appState);

	let selview = Ext.create('PVE.form.ViewSelector', {
	    flex: 1,
	    padding: '0 5 0 0',
	});

	let rtree = Ext.createWidget('pveResourceTree', {
	    viewFilter: selview.getViewFilter(),
	    flex: 1,
	    selModel: {
		selType: 'treemodel',
		listeners: {
		    selectionchange: function(sm, selected) {
			if (selected.length <= 0) {
			    return;
			}
			let treeNode = selected[0];
			let treeTypeToClass = {
			    root: 'PVE.dc.Config',
			    node: 'PVE.node.Config',
			    qemu: 'PVE.qemu.Config',
			    lxc: 'pveLXCConfig',
			    storage: 'PVE.storage.Browser',
			    sdn: 'PVE.sdn.Browser',
			    pool: 'pvePoolConfig',
			    tag: 'pveTagConfig',
			};
			PVE.curSelectedNode = treeNode;
			me.setContent({
			    xtype: treeTypeToClass[treeNode.data.type || 'root'] || 'pvePanelConfig',
			    showSearch: treeNode.data.id === 'root' || Ext.isDefined(treeNode.data.groupbyid),
			    pveSelNode: treeNode,
			    workspace: me,
			    viewFilter: selview.getViewFilter(),
			});
		    },
		},
	    },
	});

	selview.on('select', function(combo, records) {
	    if (records) {
		let view = combo.getViewFilter();
		rtree.setViewFilter(view);
	    }
	});

	let caps = appState.get('GuiCap');

	let createVM = Ext.createWidget('button', {
	    pack: 'end',
	    margin: '3 5 0 0',
	    baseCls: 'x-btn',
	    iconCls: 'fa fa-desktop',
	    text: gettext("Create VM"),
	    disabled: !caps.vms['VM.Allocate'],
	    handler: function() {
		let wiz = Ext.create('PVE.qemu.CreateWizard', {});
		wiz.show();
	    },
	});

	let createCT = Ext.createWidget('button', {
	    pack: 'end',
	    margin: '3 5 0 0',
	    baseCls: 'x-btn',
	    iconCls: 'fa fa-cube',
	    text: gettext("Create CT"),
	    disabled: !caps.vms['VM.Allocate'],
	    handler: function() {
		let wiz = Ext.create('PVE.lxc.CreateWizard', {});
		wiz.show();
	    },
	});

	appState.on('statechange', function(sp, key, value) {
	    if (key === 'GuiCap' && value) {
		caps = value;
		createVM.setDisabled(!caps.vms['VM.Allocate']);
		createCT.setDisabled(!caps.vms['VM.Allocate']);
	    }
	});

	Ext.apply(me, {
	    layout: { type: 'border' },
	    border: false,
	    items: [
		{
		    region: 'north',
		    title: gettext('Header'), // for ARIA
		    header: false, // avoid rendering the title
		    layout: {
			type: 'hbox',
			align: 'middle',
		    },
		    baseCls: 'x-plain',
		    defaults: {
			baseCls: 'x-plain',
		    },
		    border: false,
		    margin: '2 0 2 5',
		    items: [
			{
			    html: `<div style="padding-right: 4px; padding-left: 2px"><img class="shakeMe" src="/pve2/images/pve-electrified_logo.png" height="30" style="position: relative; top:2px"></div>`,
			},
			{
			    minWidth: 150,
			    id: 'versioninfo',
			    html: 'Virtual Environment',
			    style: {
				'font-size': '14px',
				'line-height': '18px',
			    },
			},
			{
				html: `Powered by`,
				style: {
					'font-size': '14px',
					'line-height': '18px',
				},
			},
			{
				html: `<div style="height:30px;padding-top: 7px; padding-left: 2px"><img src="/pve2/images/proxmox_logo.png" height="15"/></div>`,
			},
			{
				html: `<div style="width:8px;"/>`, // Some space
			},
			{
			    xtype: 'pveGlobalSearchField',
			    tree: rtree,
			},
			{
			    flex: 1,
			},
			(!window.electrifiedApp.webBuildState.builtWeb.buildOptions.buildStaticFiles? // Served with vite-devserver?
				{
					html: `<div style="padding-right: 4px"><span class="fa fa-code x-btn-icon-el-default-toolbar-small"></span> <i>Serving web with the <strong>vite devserver</strong>.</i> <a target="webBuild" href="/webBuild">Open web build control panel</a></div>`
				}
			:
				undefined
			),
			{
			    xtype: 'proxmoxHelpButton',
			    hidden: false,
			    baseCls: 'x-btn',
			    iconCls: 'fa fa-book x-btn-icon-el-default-toolbar-small ',
			    listenToGlobalEvent: false,
			    onlineHelp: 'pve_documentation_index',
			    text: gettext('Documentation'),
			    margin: '0 5 0 0',
			},
			createVM,
			createCT,
			// Settings menu:
			{
				xtype: 'button',
				id: 'settingsMenu',
				//text: gettext('Settings'),
				margin: '0 5 0 0',
				baseCls: 'x-btn',
				style: {
					// proxmox dark grey p light grey as border
					backgroundColor: '#464d4d',
					borderColor: '#ABBABA',
				},
				iconCls: 'fa fa-gear',
				menu: [
					{
						iconCls: 'fa fa-gear',
						text: gettext('My Settings'),
						handler: function() {
							var win = Ext.create('PVE.window.Settings');
							win.show();
						},
					},
					{
						iconCls: 'fa fa-paint-brush',
						text: gettext('Color Theme'),
						handler: function() {
							Ext.create('Proxmox.window.ThemeEditWindow')
								.show();
						},
					},
					{
						iconCls: 'fa fa-language',
						text: gettext('Language'),
						handler: function() {
							Ext.create('Proxmox.window.LanguageEditWindow')
								.show();
						},
					},
					{
						iconCls: 'fa fa-code',
						text: gettext('Web build control panel'),
						handler: function() {
							window.open("/webBuild", "webBuild");
						},
					},
				]
			},
			{
			    pack: 'end',
			    margin: '0 5 0 0',
			    id: 'userinfo',
			    xtype: 'button',
			    baseCls: 'x-btn',
			    style: {
				// proxmox dark grey p light grey as border
				backgroundColor: '#464d4d',
				borderColor: '#ABBABA',
			    },
			    iconCls: 'fa fa-user',
			    menu: [

				{
				    text: gettext('Password'),
				    itemId: 'passworditem',
				    iconCls: 'fa fa-fw fa-key',
				    handler: function() {
					var win = Ext.create('Proxmox.window.PasswordEdit', {
					    userid: Proxmox.UserName,
					    confirmCurrentPassword: Proxmox.UserName !== 'root@pam',
					    minLength: 8,
					});
					win.show();
				    },
				},
				{
				    text: 'TFA',
				    itemId: 'tfaitem',
				    iconCls: 'fa fa-fw fa-lock',
				    handler: function(btn, event, rec) {
					Ext.state.Manager.getProvider().set('dctab', { value: 'tfa' }, true);
					me.selectById('root');
				    },
				},
				'-',
				{
				    iconCls: 'fa fa-fw fa-sign-out',
				    text: gettext("Logout"),
				    handler: function() {
					PVE.data.ResourceStore.loadData([], false);
					me.showLogin();
					me.setContent(null);
					var rt = me.down('pveResourceTree');
					rt.setDatacenterText(undefined);
					rt.clearTree();

					// empty the stores of the StatusPanel child items
					var statusPanels = Ext.ComponentQuery.query('pveStatusPanel grid');
					Ext.Array.forEach(statusPanels, function(comp) {
					    if (comp.getStore()) {
						comp.getStore().loadData([], false);
					    }
					});
				    },
				},
			    ],
			},
		    ],
		},
		{
		    region: 'center',
		    stateful: true,
		    stateId: 'pvecenter',
		    minWidth: 100,
		    minHeight: 100,
		    id: 'content',
		    xtype: 'container',
		    layout: { type: 'card' },
		    border: false,
		    margin: '0 5 0 0',
		    items: [],
		},
		{
		    region: 'west',
		    stateful: true,
		    stateId: 'pvewest',
		    itemId: 'west',
		    xtype: 'container',
		    border: false,
		    layout: { type: 'vbox', align: 'stretch' },
		    margin: '0 0 0 5',
		    split: true,
		    width: 300,
		    items: [
			{
			    xtype: 'container',
			    layout: 'hbox',
			    padding: '0 0 5 0',
			    items: [
				selview,
				{
				    xtype: 'button',
				    cls: 'x-btn-default-toolbar-small',
				    iconCls: 'fa fa-fw fa-gear x-btn-icon-el-default-toolbar-small',
				    handler: () => {
					Ext.create('PVE.window.TreeSettingsEdit', {
					    autoShow: true,
					    apiCallDone: () => PVE.UIOptions.fireUIConfigChanged(),
					});
				    },
				},
			    ],
			},
			rtree,
		    ],
		    listeners: {
			resize: function(panel, width, height) {
			    var viewWidth = me.getSize().width;
			    if (width > viewWidth - 100 && viewWidth > 150) {
				panel.setWidth(viewWidth - 100);
			    }
			},
		    },
		},
		{
		    xtype: 'pveStatusPanel',
		    stateful: true,
		    stateId: 'pvesouth',
		    itemId: 'south',
		    region: 'south',
		    margin: '0 5 5 5',
		    title: gettext('Logs'),
		    collapsible: true,
		    header: false,
		    height: 200,
		    split: true,
		    listeners: {
			resize: function(panel, width, height) {
			    var viewHeight = me.getSize().height;
			    if (height > viewHeight - 150 && viewHeight > 200) {
				panel.setHeight(viewHeight - 150);
			    }
			},
		    },
		},
	    ],
	});

	me.callParent();

	me.updateUserInfo();

	// on resize, center all modal windows
	Ext.on('resize', function() {
	    let modalWindows = Ext.ComponentQuery.query('window[modal]');
	    if (modalWindows.length > 0) {
		modalWindows.forEach(win => win.alignTo(me, 'c-c'));
	    }
	});

	let tagSelectors = [];
	['circle', 'dense'].forEach((style) => {
	    ['dark', 'light'].forEach((variant) => {
		let selector = `.proxmox-tags-${style} :not(.proxmox-tags-full) > .proxmox-tag-${variant}`;
		tagSelectors.push(selector);
	    });
	});

	Ext.create('Ext.tip.ToolTip', {
	    target: me.el,
	    delegate: tagSelectors.join(', '),
	    trackMouse: true,
	    renderTo: Ext.getBody(),
	    border: 0,
	    minWidth: 0,
	    padding: 0,
	    bodyBorder: 0,
	    bodyPadding: 0,
	    dismissDelay: 0,
	    userCls: 'pmx-tag-tooltip',
	    shadow: false,
	    listeners: {
		beforeshow: function(tip) {
		    let tag = Ext.htmlEncode(tip.triggerElement.innerHTML);
		    let tagEl = Proxmox.Utils.getTagElement(tag, PVE.UIOptions.tagOverrides);
		    tip.update(`<span class="proxmox-tags-full">${tagEl}</span>`);
		},
	    },
	});
    },
});


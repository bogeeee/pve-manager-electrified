Ext.define('PVE.ceph.CephInstallWizardInfo', {
    extend: 'Ext.panel.Panel',
    xtype: 'pveCephInstallWizardInfo',

    html: `<h3>Ceph?</h3>
    <blockquote cite="https://ceph.com/"><p>"<b>Ceph</b> is a unified,
    distributed storage system, designed for excellent performance, reliability,
    and scalability."</p></blockquote>
    <p>
    <b>Ceph</b> is currently <b>not installed</b> on this node. This wizard
    will guide you through the installation. Click on the next button below
    to begin. After the initial installation, the wizard will offer to create
    an initial configuration. This configuration step is only
    needed once per cluster and will be skipped if a config is already present.
    </p>
    <p>
    Before starting the installation, please take a look at our documentation,
    by clicking the help button below. If you want to gain deeper knowledge about
    Ceph, visit <a target="_blank" href="https://docs.ceph.com/en/latest/">ceph.com</a>.
    </p>`,
});

Ext.define('PVE.ceph.CephVersionSelector', {
    extend: 'Ext.form.field.ComboBox',
    xtype: 'pveCephVersionSelector',

    fieldLabel: gettext('Ceph version to install'),

    displayField: 'display',
    valueField: 'release',

    queryMode: 'local',
    editable: false,
    forceSelection: true,

    store: {
        fields: [
            'release',
            'version',
            {
                name: 'display',
                calculate: (d) => `${d.release} (${d.version})`,
            },
        ],
        proxy: {
            type: 'memory',
            reader: {
                type: 'json',
            },
        },
        data: [{ release: 'squid', version: '19.2' }],
    },
});

Ext.define('PVE.ceph.CephHighestVersionDisplay', {
    extend: 'Ext.form.field.Display',
    xtype: 'pveCephHighestVersionDisplay',

    fieldLabel: gettext('Ceph in the cluster'),

    value: 'unknown',

    // called on success with (release, versionTxt, versionParts)
    gotNewestVersion: Ext.emptyFn,

    initComponent: function () {
        let me = this;

        me.callParent(arguments);

        Proxmox.Utils.API2Request({
            method: 'GET',
            url: '/cluster/ceph/metadata',
            params: {
                scope: 'versions',
            },
            waitMsgTarget: me,
            success: (response) => {
                let res = response.result;
                if (!res || !res.data || !res.data.node) {
                    me.setValue(gettext('Could not detect a ceph installation in the cluster'));
                    return;
                }
                let nodes = res.data.node;
                if (me.nodename) {
                    // can happen on ceph purge, we do not yet cleanup old version data
                    delete nodes[me.nodename];
                }

                let maxversion = [];
                let maxversiontext = '';
                for (const [_nodename, data] of Object.entries(nodes)) {
                    let version = data.version.parts;
                    if (PVE.Utils.compare_ceph_versions(version, maxversion) > 0) {
                        maxversion = version;
                        maxversiontext = data.version.str;
                    }
                }
                // FIXME: get from version selector store
                const major2release = {
                    13: 'luminous',
                    14: 'nautilus',
                    15: 'octopus',
                    16: 'pacific',
                    17: 'quincy',
                    18: 'reef',
                    19: 'squid',
                    20: 'tentacle',
                };
                let release = major2release[maxversion[0]] || 'unknown';
                let newestVersionTxt = `${Ext.String.capitalize(release)} (${maxversiontext})`;

                if (release === 'unknown') {
                    me.setValue(gettext('Could not detect a ceph installation in the cluster'));
                } else {
                    me.setValue(
                        Ext.String.format(
                            gettext('Newest ceph version in cluster is {0}'),
                            newestVersionTxt,
                        ),
                    );
                }
                me.gotNewestVersion(release, maxversiontext, maxversion);
            },
            failure: function (response, opts) {
                Ext.Msg.alert(gettext('Error'), response.htmlStatus);
            },
        });
    },
});

Ext.define('PVE.ceph.CephInstallWizard', {
    extend: 'PVE.window.Wizard',
    alias: 'widget.pveCephInstallWizard',
    mixins: ['Proxmox.Mixin.CBind'],

    resizable: false,
    nodename: undefined,

    width: 760, // 4:3
    height: 570,

    viewModel: {
        data: {
            nodename: '',
            cephRelease: 'squid', // default
            cephRepo: 'enterprise',
            configuration: true,
            isInstalled: false,
            nodeHasSubscription: true, // avoid warning hint until fully loaded
            allHaveSubscription: true, // avoid warning hint until fully loaded
            selectedReleaseIsTechPreview: false, // avoid warning hint until fully loaded
        },
        formulas: {
            repoHintHidden: (get) => get('allHaveSubscription') && get('cephRepo') === 'enterprise',
            repoHint: function (get) {
                let repo = get('cephRepo');
                let nodeSub = get('nodeHasSubscription'),
                    allSub = get('allHaveSubscription');

                if (repo === 'enterprise') {
                    if (!nodeSub) {
                        return gettext(
                            'The enterprise repository is enabled, but there is no active subscription!',
                        );
                    } else if (!allSub) {
                        return gettext(
                            'Not all nodes have an active subscription, which is required for cluster-wide enterprise repo access',
                        );
                    }
                    return ''; // should be hidden
                } else if (repo === 'no-subscription') {
                    return allSub
                        ? gettext(
                              'Cluster has active subscriptions and would be eligible for using the enterprise repository.',
                          )
                        : gettext(
                              'The no-subscription repository is not the best choice for production setups.',
                          );
                } else if (repo === 'manual') {
                    return gettext(
                        'The manual repository option expects that the repository is already configured. For example, in combination with the Proxmox Offline Mirror.',
                    );
                } else {
                    return gettext(
                        'The test repository should only be used for test setups or after consulting the official Proxmox support!',
                    );
                }
            },
        },
    },
    cbindData: {
        nodename: undefined,
    },

    title: gettext('Setup'),
    navigateNext: function () {
        var tp = this.down('#wizcontent');
        var atab = tp.getActiveTab();

        var next = tp.items.indexOf(atab) + 1;
        var ntab = tp.items.getAt(next);
        if (ntab) {
            ntab.enable();
            tp.setActiveTab(ntab);
        }
    },
    setInitialTab: function (index) {
        var tp = this.down('#wizcontent');
        var initialTab = tp.items.getAt(index);
        initialTab.enable();
        tp.setActiveTab(initialTab);
    },
    onShow: function () {
        this.callParent(arguments);
        let viewModel = this.getViewModel();
        var isInstalled = this.getViewModel().get('isInstalled');
        if (isInstalled) {
            viewModel.set('configuration', false);
            this.setInitialTab(2);
        }

        PVE.Utils.getClusterSubscriptionLevel().then((subcriptionMap) => {
            viewModel.set('nodeHasSubscription', !!subcriptionMap[this.nodename]);

            let allHaveSubscription = Object.values(subcriptionMap).every((level) => !!level);
            viewModel.set('allHaveSubscription', allHaveSubscription);
        });
    },
    items: [
        {
            xtype: 'panel',
            title: gettext('Info'),
            viewModel: {}, // needed to inherit parent viewModel data
            border: false,
            bodyBorder: false,
            onlineHelp: 'chapter_pveceph',
            layout: {
                type: 'vbox',
                align: 'stretch',
            },
            defaults: {
                border: false,
                bodyBorder: false,
            },
            items: [
                {
                    xtype: 'pveCephInstallWizardInfo',
                },
                {
                    flex: 1,
                },
                {
                    xtype: 'displayfield',
                    fieldLabel: gettext('Hint'),
                    labelClsExtra: 'pmx-hint',
                    submitValue: false,
                    labelWidth: 50,
                    bind: {
                        value: '{repoHint}',
                        hidden: '{repoHintHidden}',
                    },
                },
                {
                    xtype: 'displayfield',
                    fieldLabel: gettext('Note'),
                    labelClsExtra: 'pmx-hint',
                    submitValue: false,
                    labelWidth: 50,
                    value: gettext(
                        'The selected release is currently considered a Technology Preview. Although we are not aware of any major issues, there may be some bugs and the Enterprise Repository is not yet available.',
                    ),
                    bind: {
                        hidden: '{!selectedReleaseIsTechPreview}',
                    },
                },
                {
                    xtype: 'pveCephHighestVersionDisplay',
                    labelWidth: 150,
                    cbind: {
                        nodename: '{nodename}',
                    },
                    gotNewestVersion: function (release, maxversiontext, maxversion) {
                        if (release === 'unknown') {
                            return;
                        }
                        let wizard = this.up('pveCephInstallWizard');
                        wizard.getViewModel().set('cephRelease', release);
                    },
                },
                {
                    xtype: 'container',
                    layout: 'hbox',
                    defaults: {
                        border: false,
                        layout: 'anchor',
                        flex: 1,
                    },
                    items: [
                        {
                            xtype: 'pveCephVersionSelector',
                            labelWidth: 150,
                            padding: '0 10 0 0',
                            submitValue: false,
                            bind: {
                                value: '{cephRelease}',
                            },
                            listeners: {
                                change: function (field, release) {
                                    let me = this;
                                    let wizard = this.up('pveCephInstallWizard');
                                    wizard
                                        .down('#next')
                                        .setText(
                                            Ext.String.format(
                                                gettext('Start {0} installation'),
                                                release,
                                            ),
                                        );

                                    let record = me.store.findRecord(
                                        'release',
                                        release,
                                        0,
                                        false,
                                        true,
                                        true,
                                    );
                                    let releaseIsTechPreview = !!record.data.preview;
                                    wizard
                                        .getViewModel()
                                        .set('selectedReleaseIsTechPreview', releaseIsTechPreview);

                                    let repoSelector = wizard.down('#repoSelector');
                                    if (releaseIsTechPreview) {
                                        repoSelector.store.filterBy(
                                            (entry) => entry.get('key') !== 'enterprise',
                                        );
                                    } else {
                                        repoSelector.store.clearFilter();
                                    }
                                },
                            },
                        },
                        {
                            xtype: 'proxmoxKVComboBox',
                            id: 'repoSelector', // TODO: use name or reference (how to lookup that here?)
                            fieldLabel: gettext('Repository'),
                            padding: '0 0 0 10',
                            comboItems: [
                                ['enterprise', gettext('Enterprise (recommended)')],
                                ['no-subscription', gettext('No-Subscription')],
                                ['test', gettext('Test')],
                                ['manual', gettext('Manual')],
                            ],
                            labelWidth: 150,
                            submitValue: false,
                            value: 'enterprise',
                            bind: {
                                value: '{cephRepo}',
                            },
                        },
                    ],
                },
            ],
            listeners: {
                activate: function () {
                    // notify owning container that it should display a help button
                    if (this.onlineHelp) {
                        Ext.GlobalEvents.fireEvent('proxmoxShowHelp', this.onlineHelp);
                    }
                    let wizard = this.up('pveCephInstallWizard');
                    let release = wizard.getViewModel().get('cephRelease');
                    wizard.down('#back').hide(true);
                    wizard
                        .down('#next')
                        .setText(Ext.String.format(gettext('Start {0} installation'), release));
                },
                deactivate: function () {
                    if (this.onlineHelp) {
                        Ext.GlobalEvents.fireEvent('proxmoxHideHelp', this.onlineHelp);
                    }
                    this.up('pveCephInstallWizard').down('#next').setText(gettext('Next'));
                },
            },
        },
        {
            title: gettext('Installation'),
            xtype: 'panel',
            layout: 'fit',
            cbind: {
                nodename: '{nodename}',
            },
            viewModel: {}, // needed to inherit parent viewModel data
            listeners: {
                afterrender: function () {
                    var me = this;
                    if (this.getViewModel().get('isInstalled')) {
                        this.mask(
                            'Ceph is already installed, click next to create your configuration.',
                            ['pve-static-mask'],
                        );
                    } else {
                        me.down('pveNoVncConsole').fireEvent('activate');
                    }
                },
                activate: function () {
                    let me = this;
                    const nodename = me.nodename;
                    me.updateStore = Ext.create('Proxmox.data.UpdateStore', {
                        storeid: 'ceph-status-' + nodename,
                        interval: 1000,
                        proxy: {
                            type: 'proxmox',
                            url: '/api2/json/nodes/' + nodename + '/ceph/status',
                        },
                        listeners: {
                            load: function (rec, response, success, operation) {
                                if (success) {
                                    me.updateStore.stopUpdate();
                                    me.down('textfield').setValue('success');
                                } else if (
                                    operation.error.statusText.match('not initialized', 'i')
                                ) {
                                    me.updateStore.stopUpdate();
                                    me.up('pveCephInstallWizard')
                                        .getViewModel()
                                        .set('configuration', false);
                                    me.down('textfield').setValue('success');
                                } else if (
                                    operation.error.statusText.match('rados_connect failed', 'i')
                                ) {
                                    me.updateStore.stopUpdate();
                                    me.up('pveCephInstallWizard')
                                        .getViewModel()
                                        .set('configuration', true);
                                    me.down('textfield').setValue('success');
                                } else if (
                                    !operation.error.statusText.match('not installed', 'i')
                                ) {
                                    let msg = Ext.htmlEncode(operation.error.statusText);
                                    Proxmox.Utils.setErrorMask(me, msg);
                                }
                            },
                        },
                    });
                    me.updateStore.startUpdate();
                },
                destroy: function () {
                    var me = this;
                    if (me.updateStore) {
                        me.updateStore.stopUpdate();
                    }
                },
            },
            items: [
                {
                    xtype: 'pveNoVncConsole',
                    itemId: 'jsconsole',
                    consoleType: 'cmd',
                    xtermjs: true,
                    cbind: {
                        nodename: '{nodename}',
                    },
                    beforeLoad: function () {
                        let me = this;
                        let wizard = me.up('pveCephInstallWizard');
                        let release = wizard.getViewModel().get('cephRelease');
                        let repo = wizard.getViewModel().get('cephRepo');
                        me.cmdOpts = `--version\0${release}\0--repository\0${repo}`;
                    },
                    cmd: 'ceph_install',
                },
                {
                    xtype: 'textfield',
                    name: 'installSuccess',
                    value: '',
                    allowBlank: false,
                    submitValue: false,
                    hidden: true,
                },
            ],
        },
        {
            xtype: 'inputpanel',
            title: gettext('Configuration'),
            onlineHelp: 'chapter_pveceph',
            height: 300,
            cbind: {
                nodename: '{nodename}',
            },
            viewModel: {
                data: {
                    replicas: undefined,
                    minreplicas: undefined,
                },
            },
            listeners: {
                activate: function () {
                    this.up('pveCephInstallWizard').down('#submit').setText(gettext('Next'));
                },
                afterrender: function () {
                    if (this.up('pveCephInstallWizard').getViewModel().get('configuration')) {
                        this.mask('Configuration already initialized', ['pve-static-mask']);
                    } else {
                        this.unmask();
                    }
                },
                deactivate: function () {
                    this.up('pveCephInstallWizard').down('#submit').setText(gettext('Finish'));
                },
            },
            column1: [
                {
                    xtype: 'displayfield',
                    value: gettext('Ceph cluster configuration') + ':',
                },
                {
                    xtype: 'proxmoxNetworkSelector',
                    name: 'network',
                    value: '',
                    fieldLabel: 'Public Network IP/CIDR',
                    autoSelect: false,
                    type: 'include_sdn',
                    bind: {
                        allowBlank: '{configuration}',
                    },
                    cbind: {
                        nodename: '{nodename}',
                    },
                },
                {
                    xtype: 'proxmoxNetworkSelector',
                    name: 'cluster-network',
                    fieldLabel: 'Cluster Network IP/CIDR',
                    allowBlank: true,
                    autoSelect: false,
                    type: 'include_sdn',
                    emptyText: gettext('Same as Public Network'),
                    cbind: {
                        nodename: '{nodename}',
                    },
                },
                // FIXME: add hint about cluster network and/or reference user to docs??
            ],
            column2: [
                {
                    xtype: 'displayfield',
                    value: gettext('First Ceph monitor') + ':',
                },
                {
                    xtype: 'displayfield',
                    fieldLabel: gettext('Monitor node'),
                    cbind: {
                        value: '{nodename}',
                    },
                },
                {
                    xtype: 'displayfield',
                    value: gettext(
                        'Additional monitors are recommended. They can be created at any time in the Monitor tab.',
                    ),
                    userCls: 'pmx-hint',
                },
            ],
            advancedColumn1: [
                {
                    xtype: 'numberfield',
                    name: 'size',
                    fieldLabel: 'Number of replicas',
                    bind: {
                        value: '{replicas}',
                    },
                    maxValue: 7,
                    minValue: 2,
                    emptyText: '3',
                },
                {
                    xtype: 'numberfield',
                    name: 'min_size',
                    fieldLabel: 'Minimum replicas',
                    bind: {
                        maxValue: '{replicas}',
                        value: '{minreplicas}',
                    },
                    minValue: 2,
                    maxValue: 3,
                    setMaxValue: function (value) {
                        this.maxValue = Ext.Number.from(value, 2);
                        // allow enough to avoid split brains with max 'size', but more makes simply no sense
                        if (this.maxValue > 4) {
                            this.maxValue = 4;
                        }
                        this.toggleSpinners();
                        this.validate();
                    },
                    emptyText: '2',
                },
            ],
            onGetValues: function (values) {
                ['cluster-network', 'size', 'min_size'].forEach(function (field) {
                    if (!values[field]) {
                        delete values[field];
                    }
                });
                return values;
            },
            onSubmit: function () {
                var me = this;
                if (!this.up('pveCephInstallWizard').getViewModel().get('configuration')) {
                    let wizard = me.up('window');
                    let kv = wizard.getValues();
                    delete kv.delete;
                    let nodename = me.nodename;
                    delete kv.nodename;
                    Proxmox.Utils.API2Request({
                        url: `/nodes/${nodename}/ceph/init`,
                        waitMsgTarget: wizard,
                        method: 'POST',
                        params: kv,
                        success: function () {
                            Proxmox.Utils.API2Request({
                                url: `/nodes/${nodename}/ceph/mon/${nodename}`,
                                waitMsgTarget: wizard,
                                method: 'POST',
                                success: function () {
                                    me.up('pveCephInstallWizard').navigateNext();
                                },
                                failure: function (response, opts) {
                                    Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                                },
                            });
                        },
                        failure: function (response, opts) {
                            Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                        },
                    });
                } else {
                    me.up('pveCephInstallWizard').navigateNext();
                }
            },
        },
        {
            title: gettext('Success'),
            xtype: 'panel',
            border: false,
            bodyBorder: false,
            onlineHelp: 'pve_ceph_install',
            html:
                '<h3>Installation successful!</h3>' +
                '<p>The basic installation and configuration is complete. Depending on your setup, some of the following steps are required to start using Ceph:</p>' +
                '<ol><li>Install Ceph on other nodes</li>' +
                '<li>Create additional Ceph Monitors</li>' +
                '<li>Create Ceph OSDs</li>' +
                '<li>Create Ceph Pools</li></ol>' +
                '<p>To learn more, click on the help button below.</p>',
            listeners: {
                activate: function () {
                    // notify owning container that it should display a help button
                    if (this.onlineHelp) {
                        Ext.GlobalEvents.fireEvent('proxmoxShowHelp', this.onlineHelp);
                    }

                    var tp = this.up('#wizcontent');
                    var idx = tp.items.indexOf(this) - 1;
                    for (; idx >= 0; idx--) {
                        let nc = tp.items.getAt(idx);
                        if (nc) {
                            nc.disable();
                        }
                    }
                },
                deactivate: function () {
                    if (this.onlineHelp) {
                        Ext.GlobalEvents.fireEvent('proxmoxHideHelp', this.onlineHelp);
                    }
                },
            },
            onSubmit: function () {
                var wizard = this.up('pveCephInstallWizard');
                wizard.close();
            },
        },
    ],
});

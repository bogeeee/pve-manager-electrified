Ext.define('PVE.node.Config', {
    extend: 'PVE.panel.Config',
    alias: 'widget.PVE.node.Config',

    onlineHelp: 'chapter_system_administration',

    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        var caps = Ext.state.Manager.get('GuiCap');

        me.statusStore = Ext.create('Proxmox.data.ObjectStore', {
            url: '/api2/json/nodes/' + nodename + '/status',
            interval: 5000,
        });

        var node_command = function (cmd) {
            Proxmox.Utils.API2Request({
                params: { command: cmd },
                url: '/nodes/' + nodename + '/status',
                method: 'POST',
                waitMsgTarget: me,
                failure: function (response, opts) {
                    Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                },
            });
        };

        var actionBtn = Ext.create('Ext.Button', {
            text: gettext('Bulk Actions'),
            iconCls: 'fa fa-fw fa-ellipsis-v',
            disabled: !caps.vms['VM.PowerMgmt'] && !caps.vms['VM.Migrate'],
            menu: new Ext.menu.Menu({
                items: [
                    {
                        text: gettext('Bulk Start'),
                        iconCls: 'fa fa-fw fa-play',
                        disabled: !caps.vms['VM.PowerMgmt'],
                        handler: function () {
                            Ext.create('PVE.window.BulkAction', {
                                autoShow: true,
                                nodename: nodename,
                                title: gettext('Bulk Start'),
                                btnText: gettext('Start'),
                                action: 'startall',
                            });
                        },
                    },
                    {
                        text: gettext('Bulk Shutdown'),
                        iconCls: 'fa fa-fw fa-stop',
                        disabled: !caps.vms['VM.PowerMgmt'],
                        handler: function () {
                            Ext.create('PVE.window.BulkAction', {
                                autoShow: true,
                                nodename: nodename,
                                title: gettext('Bulk Shutdown'),
                                btnText: gettext('Shutdown'),
                                action: 'stopall',
                            });
                        },
                    },
                    {
                        text: gettext('Bulk Suspend'),
                        iconCls: 'fa fa-fw fa-download',
                        disabled: !caps.vms['VM.PowerMgmt'],
                        handler: function () {
                            Ext.create('PVE.window.BulkAction', {
                                autoShow: true,
                                nodename: nodename,
                                title: gettext('Bulk Suspend'),
                                btnText: gettext('Suspend'),
                                action: 'suspendall',
                            });
                        },
                    },
                    {
                        text: gettext('Bulk Migrate'),
                        iconCls: 'fa fa-fw fa-send-o',
                        disabled: !caps.vms['VM.Migrate'],
                        hidden: PVE.Utils.isStandaloneNode(),
                        handler: function () {
                            Ext.create('PVE.window.BulkAction', {
                                autoShow: true,
                                nodename: nodename,
                                title: gettext('Bulk Migrate'),
                                btnText: gettext('Migrate'),
                                action: 'migrateall',
                            });
                        },
                    },
                ],
            }),
        });

        let restartBtn = Ext.create('Proxmox.button.Button', {
            text: gettext('Reboot'),
            disabled: !caps.nodes['Sys.PowerMgmt'],
            dangerous: true,
            confirmMsg: Ext.String.format(gettext("Reboot node '{0}'?"), nodename),
            handler: function () {
                node_command('reboot');
            },
            iconCls: 'fa fa-undo',
        });

        var shutdownBtn = Ext.create('Proxmox.button.Button', {
            text: gettext('Shutdown'),
            disabled: !caps.nodes['Sys.PowerMgmt'],
            dangerous: true,
            confirmMsg: Ext.String.format(gettext("Shutdown node '{0}'?"), nodename),
            handler: function () {
                node_command('shutdown');
            },
            iconCls: 'fa fa-power-off',
        });

        var shellBtn = Ext.create('PVE.button.ConsoleButton', {
            disabled: !caps.nodes['Sys.Console'],
            text: gettext('Shell'),
            consoleType: 'shell',
            nodename: nodename,
        });

        me.items = [];

        Ext.apply(me, {
            title: gettext('Node') + " '" + nodename + "'",
            hstateid: 'nodetab',
            defaults: {
                statusStore: me.statusStore,
            },
            tbar: [restartBtn, shutdownBtn, shellBtn, actionBtn],
        });

        if (caps.nodes['Sys.Audit']) {
            me.items.push(
                {
                    xtype: 'pveNodeSummary',
                    title: gettext('Summary'),
                    iconCls: 'fa fa-book',
                    itemId: 'summary',
                },
                {
                    xtype: 'pmxNotesView',
                    title: gettext('Notes'),
                    iconCls: 'fa fa-sticky-note-o',
                    itemId: 'notes',
                },
            );
        }

        if (caps.nodes['Sys.Console']) {
            me.items.push({
                xtype: 'pveNoVncConsole',
                title: gettext('Shell'),
                iconCls: 'fa fa-terminal',
                itemId: 'jsconsole',
                consoleType: 'shell',
                xtermjs: true,
                nodename: nodename,
            });
        }

        if (caps.nodes['Sys.Audit']) {
            me.items.push(
                {
                    xtype: 'proxmoxNodeServiceView',
                    title: gettext('System'),
                    iconCls: 'fa fa-cogs',
                    itemId: 'services',
                    expandedOnInit: true,
                    restartCommand: 'reload', // avoid disruptions
                    startOnlyServices: {
                        pveproxy: true,
                        pvedaemon: true,
                        'pve-cluster': true,
                    },
                    nodename: nodename,
                    onlineHelp: 'pve_service_daemons',
                },
                {
                    xtype: 'proxmoxNodeNetworkView',
                    title: gettext('Network'),
                    iconCls: 'fa fa-exchange',
                    itemId: 'network',
                    showApplyBtn: true,
                    showAltNames: true,
                    groups: ['services'],
                    nodename: nodename,
                    editOptions: {
                        enableBridgeVlanIds: true,
                    },
                    onlineHelp: 'sysadmin_network_configuration',
                },
                {
                    xtype: 'pveCertificatesView',
                    title: gettext('Certificates'),
                    iconCls: 'fa fa-certificate',
                    itemId: 'certificates',
                    groups: ['services'],
                    nodename: nodename,
                },
                {
                    xtype: 'proxmoxNodeDNSView',
                    title: gettext('DNS'),
                    iconCls: 'fa fa-globe',
                    groups: ['services'],
                    itemId: 'dns',
                    nodename: nodename,
                    onlineHelp: 'sysadmin_network_configuration',
                },
                {
                    xtype: 'proxmoxNodeHostsView',
                    title: gettext('Hosts'),
                    iconCls: 'fa fa-globe',
                    groups: ['services'],
                    itemId: 'hosts',
                    nodename: nodename,
                    onlineHelp: 'sysadmin_network_configuration',
                },
                {
                    xtype: 'proxmoxNodeOptionsView',
                    title: gettext('Options'),
                    iconCls: 'fa fa-gear',
                    groups: ['services'],
                    itemId: 'options',
                    nodename: nodename,
                    onlineHelp: 'proxmox_node_management',
                },
                {
                    xtype: 'proxmoxNodeTimeView',
                    title: gettext('Time'),
                    itemId: 'time',
                    groups: ['services'],
                    nodename: nodename,
                    iconCls: 'fa fa-clock-o',
                },
            );
        }

        if (caps.nodes['Sys.Syslog']) {
            me.items.push({
                xtype: 'proxmoxJournalView',
                title: gettext('System Log'),
                iconCls: 'fa fa-list',
                groups: ['services'],
                disabled: !caps.nodes['Sys.Syslog'],
                itemId: 'syslog',
                url: '/api2/extjs/nodes/' + nodename + '/journal',
            });

            if (caps.nodes['Sys.Modify']) {
                me.items.push({
                    xtype: 'proxmoxNodeAPT',
                    title: gettext('Updates'),
                    iconCls: 'fa fa-refresh',
                    expandedOnInit: true,
                    disabled: !caps.nodes['Sys.Console'],
                    // do we want to link to system updates instead?
                    itemId: 'apt',
                    upgradeBtn: {
                        xtype: 'pveConsoleButton',
                        disabled: Proxmox.UserName !== 'root@pam',
                        text: gettext('Upgrade'),
                        consoleType: 'upgrade',
                        nodename: nodename,
                    },
                    nodename: nodename,
                });

                me.items.push({
                    xtype: 'proxmoxNodeAPTRepositories',
                    title: gettext('Repositories'),
                    iconCls: 'fa fa-files-o',
                    itemId: 'aptrepositories',
                    nodename: nodename,
                    onlineHelp: 'sysadmin_package_repositories',
                    groups: ['apt'],
                });
            }
        }

        if (caps.nodes['Sys.Audit']) {
            me.items.push(
                {
                    xtype: 'pveFirewallRules',
                    iconCls: 'fa fa-shield',
                    title: gettext('Firewall'),
                    allow_iface: true,
                    base_url: '/nodes/' + nodename + '/firewall/rules',
                    list_refs_url: '/cluster/firewall/refs',
                    itemId: 'firewall',
                    firewall_type: 'node',
                },
                {
                    xtype: 'pveFirewallOptions',
                    title: gettext('Options'),
                    iconCls: 'fa fa-gear',
                    onlineHelp: 'pve_firewall_host_specific_configuration',
                    groups: ['firewall'],
                    base_url: '/nodes/' + nodename + '/firewall/options',
                    fwtype: 'node',
                    itemId: 'firewall-options',
                },
            );
        }

        if (caps.nodes['Sys.Audit']) {
            me.items.push(
                {
                    xtype: 'pmxDiskList',
                    title: gettext('Disks'),
                    itemId: 'storage',
                    expandedOnInit: true,
                    iconCls: 'fa fa-hdd-o',
                    nodename: nodename,
                    includePartitions: true,
                    supportsWipeDisk: true,
                },
                {
                    xtype: 'pveLVMList',
                    title: 'LVM',
                    itemId: 'lvm',
                    onlineHelp: 'chapter_lvm',
                    iconCls: 'fa fa-square',
                    groups: ['storage'],
                },
                {
                    xtype: 'pveLVMThinList',
                    title: 'LVM-Thin',
                    itemId: 'lvmthin',
                    onlineHelp: 'chapter_lvm',
                    iconCls: 'fa fa-square-o',
                    groups: ['storage'],
                },
                {
                    xtype: 'pveDirectoryList',
                    title: Proxmox.Utils.directoryText,
                    itemId: 'directory',
                    onlineHelp: 'chapter_storage',
                    iconCls: 'fa fa-folder',
                    groups: ['storage'],
                },
                {
                    title: 'ZFS',
                    itemId: 'zfs',
                    onlineHelp: 'chapter_zfs',
                    iconCls: 'fa fa-th-large',
                    groups: ['storage'],
                    xtype: 'pveZFSList',
                },
                {
                    xtype: 'pveNodeCephStatus',
                    title: 'Ceph',
                    itemId: 'ceph',
                    iconCls: 'fa fa-ceph',
                },
                {
                    xtype: 'pveNodeCephConfigCrush',
                    title: gettext('Configuration'),
                    iconCls: 'fa fa-gear',
                    groups: ['ceph'],
                    itemId: 'ceph-config',
                },
                {
                    xtype: 'pveNodeCephMonMgr',
                    title: gettext('Monitor'),
                    iconCls: 'fa fa-tv',
                    groups: ['ceph'],
                    itemId: 'ceph-monlist',
                },
                {
                    xtype: 'pveNodeCephOsdTree',
                    title: 'OSD',
                    iconCls: 'fa fa-hdd-o',
                    groups: ['ceph'],
                    itemId: 'ceph-osdtree',
                },
                {
                    xtype: 'pveNodeCephFSPanel',
                    title: 'CephFS',
                    iconCls: 'fa fa-folder',
                    groups: ['ceph'],
                    nodename: nodename,
                    itemId: 'ceph-cephfspanel',
                },
                {
                    xtype: 'pveNodeCephPoolList',
                    title: gettext('Pools'),
                    iconCls: 'fa fa-sitemap',
                    groups: ['ceph'],
                    itemId: 'ceph-pools',
                },
                {
                    xtype: 'pveReplicaView',
                    iconCls: 'fa fa-retweet',
                    title: gettext('Replication'),
                    itemId: 'replication',
                },
            );
        }

        if (caps.nodes['Sys.Syslog']) {
            me.items.push(
                {
                    xtype: 'proxmoxLogView',
                    title: gettext('Log'),
                    iconCls: 'fa fa-list',
                    groups: ['firewall'],
                    onlineHelp: 'chapter_pve_firewall',
                    url: '/api2/extjs/nodes/' + nodename + '/firewall/log',
                    itemId: 'firewall-fwlog',
                    log_select_timespan: true,
                    submitFormat: 'U',
                },
                {
                    xtype: 'cephLogView',
                    title: gettext('Log'),
                    itemId: 'ceph-log',
                    iconCls: 'fa fa-list',
                    groups: ['ceph'],
                    onlineHelp: 'chapter_pveceph',
                    url: '/api2/extjs/nodes/' + nodename + '/ceph/log',
                    nodename: nodename,
                },
            );
        }

        me.items.push(
            {
                title: gettext('Task History'),
                iconCls: 'fa fa-list-alt',
                itemId: 'tasks',
                nodename: nodename,
                xtype: 'proxmoxNodeTasks',
                extraFilter: [
                    {
                        xtype: 'pveGuestIDSelector',
                        fieldLabel: 'VMID',
                        allowBlank: true,
                        name: 'vmid',
                    },
                ],
            },
            {
                title: gettext('Subscription'),
                iconCls: 'fa fa-support',
                itemId: 'support',
                xtype: 'pveNodeSubscription',
                nodename: nodename,
            },
        );


        window.electrifiedApp._addElectrifiedNodeConfigTabs(nodename, me.items);


        me.callParent();

        me.mon(me.statusStore, 'load', function (store, records, success) {
            let uptimerec = store.data.get('uptime');
            let powermgmt = caps.nodes['Sys.PowerMgmt'] && uptimerec && uptimerec.data.value;

            restartBtn.setDisabled(!powermgmt);
            shutdownBtn.setDisabled(!powermgmt);
            shellBtn.setDisabled(!powermgmt);
        });

        me.on('afterrender', function () {
            me.statusStore.startUpdate();
        });

        me.on('destroy', function () {
            me.statusStore.stopUpdate();
        });
    },
});

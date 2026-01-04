Ext.define('PVE.lxc.Config', {
    extend: 'PVE.panel.Config',
    alias: 'widget.pveLXCConfig',

    onlineHelp: 'chapter_pct',

    userCls: 'proxmox-tags-full',

    initComponent: function () {
        var me = this;
        var vm = me.pveSelNode.data;

        var nodename = vm.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        var vmid = vm.vmid;
        if (!vmid) {
            throw 'no VM ID specified';
        }

        var template = !!vm.template;

        var running = !!vm.uptime;

        var caps = Ext.state.Manager.get('GuiCap');

        var base_url = '/nodes/' + nodename + '/lxc/' + vmid;

        me.statusStore = Ext.create('Proxmox.data.ObjectStore', {
            url: '/api2/json' + base_url + '/status/current',
            interval: 1000,
        });

        var vm_command = function (cmd, params) {
            Proxmox.Utils.API2Request({
                params: params,
                url: base_url + '/status/' + cmd,
                waitMsgTarget: me,
                method: 'POST',
                failure: function (response, opts) {
                    Ext.Msg.alert('Error', response.htmlStatus);
                },
            });
        };

        var startBtn = Ext.create('Ext.Button', {
            text: gettext('Start'),
            disabled: !caps.vms['VM.PowerMgmt'] || running,
            hidden: template,
            handler: function () {
                vm_command('start');
            },
            iconCls: 'fa fa-play',
        });

        var shutdownBtn = Ext.create('PVE.button.Split', {
            text: gettext('Shutdown'),
            disabled: !caps.vms['VM.PowerMgmt'] || !running,
            hidden: template,
            confirmMsg: PVE.Utils.formatGuestTaskConfirmation('vzshutdown', vmid, vm.name),
            handler: function () {
                vm_command('shutdown');
            },
            menu: {
                items: [
                    {
                        text: gettext('Reboot'),
                        disabled: !caps.vms['VM.PowerMgmt'],
                        confirmMsg: PVE.Utils.formatGuestTaskConfirmation(
                            'vzreboot',
                            vmid,
                            vm.name,
                        ),
                        tooltip: Ext.String.format(gettext('Reboot {0}'), 'CT'),
                        handler: function () {
                            vm_command('reboot');
                        },
                        iconCls: 'fa fa-refresh',
                    },
                    {
                        text: gettext('Stop'),
                        disabled: !caps.vms['VM.PowerMgmt'],
                        tooltip: Ext.String.format(gettext('Stop {0} immediately'), 'CT'),
                        handler: function () {
                            Ext.create('PVE.GuestStop', {
                                nodename: nodename,
                                vm: vm,
                                autoShow: true,
                            });
                        },
                        iconCls: 'fa fa-stop',
                    },
                ],
            },
            iconCls: 'fa fa-power-off',
        });

        var migrateBtn = Ext.create('Ext.Button', {
            text: gettext('Migrate'),
            disabled: !caps.vms['VM.Migrate'],
            hidden: PVE.Utils.isStandaloneNode(),
            handler: function () {
                var win = Ext.create('PVE.window.Migrate', {
                    vmtype: 'lxc',
                    nodename: nodename,
                    vmid: vmid,
                    vmname: vm.name,
                });
                win.show();
            },
            iconCls: 'fa fa-send-o',
        });

        var moreBtn = Ext.create('Proxmox.button.Button', {
            text: gettext('More'),
            menu: {
                items: [
                    {
                        text: gettext('Clone'),
                        iconCls: 'fa fa-fw fa-clone',
                        hidden: !caps.vms['VM.Clone'],
                        handler: function () {
                            PVE.window.Clone.wrap(nodename, vmid, vm.name, template, 'lxc');
                        },
                    },
                    {
                        text: gettext('Convert to template'),
                        disabled: template,
                        xtype: 'pveMenuItem',
                        iconCls: 'fa fa-fw fa-file-o',
                        hidden: !caps.vms['VM.Allocate'],
                        confirmMsg: PVE.Utils.formatGuestTaskConfirmation(
                            'vztemplate',
                            vmid,
                            vm.name,
                        ),
                        handler: function () {
                            Proxmox.Utils.API2Request({
                                url: base_url + '/template',
                                waitMsgTarget: me,
                                method: 'POST',
                                failure: function (response, opts) {
                                    Ext.Msg.alert('Error', response.htmlStatus);
                                },
                            });
                        },
                    },
                    {
                        iconCls: 'fa fa-heartbeat ',
                        hidden: !caps.nodes['Sys.Console'],
                        text: gettext('Manage HA'),
                        handler: function () {
                            var ha = vm.hastate;
                            Ext.create('PVE.ha.VMResourceEdit', {
                                vmid: vmid,
                                guestType: 'ct',
                                isCreate: !ha || ha === 'unmanaged',
                            }).show();
                        },
                    },
                    {
                        text: gettext('Remove'),
                        disabled: !caps.vms['VM.Allocate'],
                        itemId: 'removeBtn',
                        handler: function () {
                            Ext.create('PVE.window.SafeDestroyGuest', {
                                url: base_url,
                                item: {
                                    type: 'CT',
                                    id: vmid,
                                    formattedIdentifier: PVE.Utils.getFormattedGuestIdentifier(
                                        vmid,
                                        vm.name,
                                    ),
                                },
                                taskName: 'vzdestroy',
                            }).show();
                        },
                        iconCls: 'fa fa-trash-o',
                    },
                ],
            },
        });

        var consoleBtn = Ext.create('PVE.button.ConsoleButton', {
            disabled: !caps.vms['VM.Console'],
            consoleType: 'lxc',
            consoleName: vm.name,
            hidden: template,
            nodename: nodename,
            vmid: vmid,
        });

        var statusTxt = Ext.create('Ext.toolbar.TextItem', {
            data: {
                lock: undefined,
            },
            tpl: ['<tpl if="lock">', '<i class="fa fa-lg fa-lock"></i> ({lock})', '</tpl>'],
        });

        let tagsContainer = Ext.create('PVE.panel.TagEditContainer', {
            tags: vm.tags,
            canEdit: !!caps.vms['VM.Config.Options'],
            listeners: {
                change: function (tags) {
                    Proxmox.Utils.API2Request({
                        url: base_url + '/config',
                        method: 'PUT',
                        params: {
                            tags,
                        },
                        success: function () {
                            me.statusStore.load();
                        },
                        failure: function (response) {
                            Ext.Msg.alert('Error', response.htmlStatus);
                            me.statusStore.load();
                        },
                    });
                },
            },
        });

        let vm_text = `${vm.vmid} (${vm.name})`;

        Ext.apply(me, {
            title: Ext.String.format(gettext("Container {0} on node '{1}'"), vm_text, nodename),
            hstateid: 'lxctab',
            tbarSpacing: false,
            tbar: [
                statusTxt,
                tagsContainer,
                '->',
                startBtn,
                shutdownBtn,
                migrateBtn,
                consoleBtn,
                moreBtn,
            ],
            defaults: { statusStore: me.statusStore },
            items: [
                {
                    title: gettext('Summary'),
                    xtype: 'pveGuestSummary',
                    iconCls: 'fa fa-book',
                    itemId: 'summary',
                },
            ],
        });

        if (caps.vms['VM.Console'] && !template) {
            me.items.push({
                title: gettext('Console'),
                itemId: 'consolejs',
                iconCls: 'fa fa-terminal',
                xtype: 'pveNoVncConsole',
                vmid: vmid,
                consoleType: 'lxc',
                xtermjs: true,
                nodename: nodename,
            });
        }

        me.items.push(
            {
                title: gettext('Resources'),
                itemId: 'resources',
                expandedOnInit: true,
                iconCls: 'fa fa-cube',
                xtype: 'pveLxcRessourceView',
            },
            {
                title: gettext('Network'),
                iconCls: 'fa fa-exchange',
                itemId: 'network',
                xtype: 'pveLxcNetworkView',
            },
            {
                title: gettext('DNS'),
                iconCls: 'fa fa-globe',
                itemId: 'dns',
                xtype: 'pveLxcDNS',
            },
            {
                title: gettext('Options'),
                itemId: 'options',
                iconCls: 'fa fa-gear',
                xtype: 'pveLxcOptions',
            },
            {
                title: gettext('Task History'),
                itemId: 'tasks',
                iconCls: 'fa fa-list-alt',
                xtype: 'proxmoxNodeTasks',
                nodename: nodename,
                preFilter: {
                    vmid,
                },
            },
        );

        if (caps.vms['VM.Backup']) {
            me.items.push(
                {
                    title: gettext('Backup'),
                    iconCls: 'fa fa-floppy-o',
                    xtype: 'pveBackupView',
                    itemId: 'backup',
                },
                {
                    title: gettext('Replication'),
                    iconCls: 'fa fa-retweet',
                    xtype: 'pveReplicaView',
                    itemId: 'replication',
                },
            );
        }

        if (
            (caps.vms['VM.Snapshot'] || caps.vms['VM.Snapshot.Rollback'] || caps.vms['VM.Audit']) &&
            !template
        ) {
            me.items.push({
                title: gettext('Snapshots'),
                iconCls: 'fa fa-history',
                xtype: 'pveGuestSnapshotTree',
                type: 'lxc',
                itemId: 'snapshot',
            });
        }

        if (caps.vms['VM.Audit']) {
            me.items.push(
                {
                    xtype: 'pveFirewallRules',
                    title: gettext('Firewall'),
                    iconCls: 'fa fa-shield',
                    allow_iface: true,
                    base_url: base_url + '/firewall/rules',
                    list_refs_url: base_url + '/firewall/refs',
                    itemId: 'firewall',
                    firewall_type: 'vm',
                },
                {
                    xtype: 'pveFirewallOptions',
                    groups: ['firewall'],
                    iconCls: 'fa fa-gear',
                    onlineHelp: 'pve_firewall_vm_container_configuration',
                    title: gettext('Options'),
                    base_url: base_url + '/firewall/options',
                    fwtype: 'vm',
                    itemId: 'firewall-options',
                },
                {
                    xtype: 'pveFirewallAliases',
                    title: gettext('Alias'),
                    groups: ['firewall'],
                    iconCls: 'fa fa-external-link',
                    base_url: base_url + '/firewall/aliases',
                    itemId: 'firewall-aliases',
                },
                {
                    xtype: 'pveIPSet',
                    title: gettext('IPSet'),
                    groups: ['firewall'],
                    iconCls: 'fa fa-list-ol',
                    base_url: base_url + '/firewall/ipset',
                    list_refs_url: base_url + '/firewall/refs',
                    itemId: 'firewall-ipset',
                },
            );
        }

        if (caps.vms['VM.Console']) {
            me.items.push({
                title: gettext('Log'),
                groups: ['firewall'],
                iconCls: 'fa fa-list',
                onlineHelp: 'chapter_pve_firewall',
                itemId: 'firewall-fwlog',
                xtype: 'proxmoxLogView',
                url: '/api2/extjs' + base_url + '/firewall/log',
                log_select_timespan: true,
                submitFormat: 'U',
            });
        }

        if (caps.vms['Permissions.Modify']) {
            me.items.push({
                xtype: 'pveACLView',
                title: gettext('Permissions'),
                itemId: 'permissions',
                iconCls: 'fa fa-unlock',
                path: '/vms/' + vmid,
            });
        }

        window.electrifiedApp._addElectrifiedLxcConfigTabs(vmid, me.items, caps);

        me.callParent();

        var prevStatus = 'unknown';
        me.mon(me.statusStore, 'load', function (s, records, success) {
            var status;
            var lock;
            var rec;

            if (!success) {
                status = 'unknown';
            } else {
                rec = s.data.get('status');
                status = rec ? rec.data.value : 'unknown';
                rec = s.data.get('template');
                template = rec ? rec.data.value : false;
                rec = s.data.get('lock');
                lock = rec ? rec.data.value : undefined;
            }

            statusTxt.update({ lock: lock });

            rec = s.data.get('tags');
            tagsContainer.loadTags(rec?.data?.value);

            startBtn.setDisabled(!caps.vms['VM.PowerMgmt'] || status === 'running' || template);
            shutdownBtn.setDisabled(!caps.vms['VM.PowerMgmt'] || status !== 'running');
            me.down('#removeBtn').setDisabled(!caps.vms['VM.Allocate'] || status !== 'stopped');
            consoleBtn.setDisabled(template);

            if (prevStatus === 'stopped' && status === 'running') {
                let con = me.down('#consolejs');
                if (con) {
                    con.reload();
                }
            }

            prevStatus = status;
        });

        me.on('afterrender', function () {
            me.statusStore.startUpdate();
        });

        me.on('destroy', function () {
            me.statusStore.stopUpdate();
        });
    },
});

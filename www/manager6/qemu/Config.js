Ext.define('PVE.qemu.Config', {
    extend: 'PVE.panel.Config',
    alias: 'widget.PVE.qemu.Config',

    onlineHelp: 'chapter_virtual_machines',
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

        var base_url = '/nodes/' + nodename + '/qemu/' + vmid;

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

        var resumeBtn = Ext.create('Ext.Button', {
            text: gettext('Resume'),
            disabled: !caps.vms['VM.PowerMgmt'],
            hidden: true,
            handler: function () {
                vm_command('resume');
            },
            iconCls: 'fa fa-play',
        });

        var startBtn = Ext.create('Ext.Button', {
            text: gettext('Start'),
            disabled: !caps.vms['VM.PowerMgmt'] || running,
            hidden: template,
            handler: function () {
                vm_command('start');
            },
            iconCls: 'fa fa-play',
        });

        var migrateBtn = Ext.create('Ext.Button', {
            text: gettext('Migrate'),
            disabled: !caps.vms['VM.Migrate'],
            hidden: PVE.Utils.isStandaloneNode(),
            handler: function () {
                var win = Ext.create('PVE.window.Migrate', {
                    vmtype: 'qemu',
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
                            PVE.window.Clone.wrap(nodename, vmid, vm.name, template, 'qemu');
                        },
                    },
                    {
                        text: gettext('Convert to template'),
                        disabled: template,
                        xtype: 'pveMenuItem',
                        iconCls: 'fa fa-fw fa-file-o',
                        hidden: !caps.vms['VM.Allocate'],
                        confirmMsg: PVE.Utils.formatGuestTaskConfirmation(
                            'qmtemplate',
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
                                isCreate: !ha || ha === 'unmanaged',
                            }).show();
                        },
                    },
                    {
                        text: gettext('Remove'),
                        itemId: 'removeBtn',
                        disabled: !caps.vms['VM.Allocate'],
                        handler: function () {
                            Ext.create('PVE.window.SafeDestroyGuest', {
                                url: base_url,
                                item: {
                                    type: 'VM',
                                    id: vmid,
                                    formattedIdentifier: PVE.Utils.getFormattedGuestIdentifier(
                                        vmid,
                                        vm.name,
                                    ),
                                },
                                taskName: 'qmdestroy',
                            }).show();
                        },
                        iconCls: 'fa fa-trash-o',
                    },
                ],
            },
        });

        var shutdownBtn = Ext.create('PVE.button.Split', {
            text: gettext('Shutdown'),
            disabled: !caps.vms['VM.PowerMgmt'] || !running,
            hidden: template,
            confirmMsg: PVE.Utils.formatGuestTaskConfirmation('qmshutdown', vmid, vm.name),
            handler: function () {
                vm_command('shutdown');
            },
            menu: {
                items: [
                    {
                        text: gettext('Reboot'),
                        disabled: !caps.vms['VM.PowerMgmt'],
                        tooltip: Ext.String.format(
                            gettext('Shutdown, apply pending changes and reboot {0}'),
                            'VM',
                        ),
                        confirmMsg: PVE.Utils.formatGuestTaskConfirmation(
                            'qmreboot',
                            vmid,
                            vm.name,
                        ),
                        handler: function () {
                            vm_command('reboot');
                        },
                        iconCls: 'fa fa-refresh',
                    },
                    {
                        text: gettext('Pause'),
                        disabled: !caps.vms['VM.PowerMgmt'],
                        confirmMsg: PVE.Utils.formatGuestTaskConfirmation('qmpause', vmid, vm.name),
                        handler: function () {
                            vm_command('suspend');
                        },
                        iconCls: 'fa fa-pause',
                    },
                    {
                        text: gettext('Hibernate'),
                        disabled: !caps.vms['VM.PowerMgmt'],
                        confirmMsg: PVE.Utils.formatGuestTaskConfirmation(
                            'qmsuspend',
                            vmid,
                            vm.name,
                        ),
                        tooltip: gettext('Suspend to disk'),
                        handler: function () {
                            vm_command('suspend', { todisk: 1 });
                        },
                        iconCls: 'fa fa-download',
                    },
                    {
                        text: gettext('Stop'),
                        disabled: !caps.vms['VM.PowerMgmt'],
                        tooltip: Ext.String.format(gettext('Stop {0} immediately'), 'VM'),
                        handler: function () {
                            Ext.create('PVE.GuestStop', {
                                nodename: nodename,
                                vm: vm,
                                autoShow: true,
                            });
                        },
                        iconCls: 'fa fa-stop',
                    },
                    {
                        text: gettext('Reset'),
                        disabled: !caps.vms['VM.PowerMgmt'],
                        tooltip: Ext.String.format(gettext('Reset {0} immediately'), 'VM'),
                        confirmMsg: PVE.Utils.formatGuestTaskConfirmation('qmreset', vmid, vm.name),
                        handler: function () {
                            vm_command('reset');
                        },
                        iconCls: 'fa fa-bolt',
                    },
                ],
            },
            iconCls: 'fa fa-power-off',
        });

        var consoleBtn = Ext.create('PVE.button.ConsoleButton', {
            disabled: !caps.vms['VM.Console'],
            hidden: template,
            consoleType: 'kvm',
            // disable spice/xterm for default action until status api call succeeded
            enableSpice: false,
            enableXtermjs: false,
            consoleName: vm.name,
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
            title: Ext.String.format(
                gettext("Virtual Machine {0} on node '{1}'"),
                vm_text,
                nodename,
            ),
            hstateid: 'kvmtab',
            tbarSpacing: false,
            tbar: [
                statusTxt,
                tagsContainer,
                '->',
                resumeBtn,
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
                itemId: 'console',
                iconCls: 'fa fa-terminal',
                xtype: 'pveNoVncConsole',
                vmid: vmid,
                consoleType: 'kvm',
                nodename: nodename,
            });
        }

        me.items.push(
            {
                title: gettext('Hardware'),
                itemId: 'hardware',
                iconCls: 'fa fa-desktop',
                xtype: 'PVE.qemu.HardwareView',
            },
            {
                title: 'Cloud-Init',
                itemId: 'cloudinit',
                iconCls: 'fa fa-cloud',
                xtype: 'pveCiPanel',
            },
            {
                title: gettext('Options'),
                iconCls: 'fa fa-gear',
                itemId: 'options',
                xtype: 'PVE.qemu.Options',
            },
            {
                title: gettext('Task History'),
                itemId: 'tasks',
                xtype: 'proxmoxNodeTasks',
                iconCls: 'fa fa-list-alt',
                nodename: nodename,
                preFilter: {
                    vmid,
                },
            },
        );

        if (caps.nodes['Sys.Audit'] && !template) {
            me.items.push({
                title: gettext('Monitor'),
                iconCls: 'fa fa-eye',
                itemId: 'monitor',
                xtype: 'pveQemuMonitor',
            });
        }

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
                type: 'qemu',
                xtype: 'pveGuestSnapshotTree',
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
                iconCls: 'fa fa-unlock',
                itemId: 'permissions',
                path: '/vms/' + vmid,
            });
        }

        me.callParent();

        var prevQMPStatus = 'unknown';
        me.mon(me.statusStore, 'load', function (s, records, success) {
            var status;
            var qmpstatus;
            var spice = false;
            var xtermjs = false;
            var lock;
            var rec;

            if (!success) {
                status = qmpstatus = 'unknown';
            } else {
                rec = s.data.get('status');
                status = rec ? rec.data.value : 'unknown';
                rec = s.data.get('qmpstatus');
                qmpstatus = rec ? rec.data.value : 'unknown';
                rec = s.data.get('template');
                template = rec ? rec.data.value : false;
                rec = s.data.get('lock');
                lock = rec ? rec.data.value : undefined;

                spice = !!s.data.get('spice');
                xtermjs = !!s.data.get('serial');
            }

            rec = s.data.get('tags');
            tagsContainer.loadTags(rec?.data?.value);

            if (template) {
                return;
            }

            var resume = ['prelaunch', 'paused', 'suspended'].indexOf(qmpstatus) !== -1;

            if (resume || lock === 'suspended') {
                startBtn.setVisible(false);
                resumeBtn.setVisible(true);
            } else {
                startBtn.setVisible(true);
                resumeBtn.setVisible(false);
            }

            consoleBtn.setEnableSpice(spice);
            consoleBtn.setEnableXtermJS(xtermjs);

            statusTxt.update({ lock: lock });

            let guest_running =
                status === 'running' && !(qmpstatus === 'shutdown' || qmpstatus === 'prelaunch');
            startBtn.setDisabled(!caps.vms['VM.PowerMgmt'] || template || guest_running);

            shutdownBtn.setDisabled(!caps.vms['VM.PowerMgmt'] || status !== 'running');
            me.down('#removeBtn').setDisabled(!caps.vms['VM.Allocate'] || status !== 'stopped');
            consoleBtn.setDisabled(template);

            let wasStopped = ['prelaunch', 'stopped', 'suspended'].indexOf(prevQMPStatus) !== -1;
            if (wasStopped && qmpstatus === 'running') {
                let con = me.down('#console');
                if (con) {
                    con.reload();
                }
            }

            prevQMPStatus = qmpstatus;
        });

        me.on('afterrender', function () {
            me.statusStore.startUpdate();
        });

        me.on('destroy', function () {
            me.statusStore.stopUpdate();
        });
    },
});

Ext.define('PVE.qemu.CmdMenu', {
    extend: 'Ext.menu.Menu',

    showSeparator: false,
    initComponent: function () {
        let me = this;

        let info = me.pveSelNode.data;
        if (!info.node) {
            throw 'no node name specified';
        }
        if (!info.vmid) {
            throw 'no VM ID specified';
        }

	let vm_command = function(cmd, params) {
	    Proxmox.Utils.API2Request({
		params: params,
		url: `/nodes/${info.node}/${info.type}/${info.vmid}/status/${cmd}`,
		method: 'POST',
		failure: (response, opts) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
	    });
	};
	let confirmedVMCommand = (cmd, params, confirmTask) => {
	    let task = confirmTask || `qm${cmd}`;
		let msg = PVE.Utils.formatGuestTaskConfirmation(task, info.vmid, info.name);
		Ext.Msg.confirm(gettext('Confirm'), msg, (btn) => {
                if (btn === 'yes') {
                    vm_command(cmd, params);
                }
            });
        };

        let caps = Ext.state.Manager.get('GuiCap');
        let standalone = PVE.Utils.isStandaloneNode();

        let running = false,
            stopped = true,
            suspended = false;
        switch (info.status) {
            case 'running':
                running = true;
                stopped = false;
                break;
            case 'suspended':
                stopped = false;
                suspended = true;
                break;
            case 'paused':
                stopped = false;
                suspended = true;
                break;
            default:
                break;
        }

        me.title = 'VM ' + info.vmid;

        me.items = [
            {
                text: gettext('Start'),
                iconCls: 'fa fa-fw fa-play',
                hidden: running || suspended,
                disabled: running || suspended,
                handler: () => vm_command('start'),
            },
            {
                text: gettext('Pause'),
                iconCls: 'fa fa-fw fa-pause',
                hidden: stopped || suspended,
                disabled: stopped || suspended,
                handler: () => confirmedVMCommand('suspend', undefined, 'qmpause'),
            },
            {
                text: gettext('Hibernate'),
                iconCls: 'fa fa-fw fa-download',
                hidden: stopped || suspended,
                disabled: stopped || suspended,
                tooltip: gettext('Suspend to disk'),
                handler: () => confirmedVMCommand('suspend', { todisk: 1 }),
            },
            {
                text: gettext('Resume'),
                iconCls: 'fa fa-fw fa-play',
                hidden: !suspended,
                handler: () => vm_command('resume'),
            },
            {
                text: gettext('Shutdown'),
                iconCls: 'fa fa-fw fa-power-off',
                disabled: stopped || suspended,
                handler: () => confirmedVMCommand('shutdown'),
            },
            {
                text: gettext('Stop'),
                iconCls: 'fa fa-fw fa-stop',
                disabled: stopped,
                tooltip: Ext.String.format(gettext('Stop {0} immediately'), 'VM'),
                handler: () => {
                    Ext.create('PVE.GuestStop', {
                        nodename: info.node,
                        vm: info,
                        autoShow: true,
                    });
                },
            },
            {
                text: gettext('Reboot'),
                iconCls: 'fa fa-fw fa-refresh',
                disabled: stopped,
                tooltip: Ext.String.format(gettext('Reboot {0}'), 'VM'),
                handler: () => confirmedVMCommand('reboot'),
            },
            {
                text: gettext('Reset'),
                iconCls: 'fa fa-fw fa-bolt',
                disabled: stopped,
                tooltip: Ext.String.format(gettext('Reset {0}'), 'VM'),
                handler: () => confirmedVMCommand('reset'),
            },
            {
                xtype: 'menuseparator',
                hidden:
                    (standalone || !caps.vms['VM.Migrate']) &&
                    !caps.vms['VM.Allocate'] &&
                    !caps.vms['VM.Clone'],
            },
            {
                text: gettext('Migrate'),
                iconCls: 'fa fa-fw fa-send-o',
                hidden: standalone || !caps.vms['VM.Migrate'],
                handler: function () {
                    Ext.create('PVE.window.Migrate', {
                        vmtype: 'qemu',
                        nodename: info.node,
                        vmid: info.vmid,
                        vmname: info.name,
                        autoShow: true,
                    });
                },
            },
            {
                text: gettext('Clone'),
                iconCls: 'fa fa-fw fa-clone',
                hidden: !caps.vms['VM.Clone'],
                handler: () =>
                    PVE.window.Clone.wrap(info.node, info.vmid, info.name, me.isTemplate, 'qemu'),
            },
            {
                text: gettext('Convert to template'),
                iconCls: 'fa fa-fw fa-file-o',
                hidden: !caps.vms['VM.Allocate'],
                handler: function () {
                    let msg = PVE.Utils.formatGuestTaskConfirmation(
                        'qmtemplate',
                        info.vmid,
                        info.name,
                    );
                    Ext.Msg.confirm(gettext('Confirm'), msg, (btn) => {
                        if (btn === 'yes') {
                            Proxmox.Utils.API2Request({
                                url: `/nodes/${info.node}/qemu/${info.vmid}/template`,
                                method: 'POST',
                                failure: (response, opts) =>
                                    Ext.Msg.alert('Error', response.htmlStatus),
                            });
                        }
                    });
                },
            },
            { xtype: 'menuseparator' },
            {
                text: gettext('Console'),
                iconCls: 'fa fa-fw fa-terminal',
                handler: function () {
                    Proxmox.Utils.API2Request({
                        url: `/nodes/${info.node}/qemu/${info.vmid}/status/current`,
                        failure: (response, opts) => Ext.Msg.alert('Error', response.htmlStatus),
                        success: function ({ result: { data } }, opts) {
                            PVE.Utils.openDefaultConsoleWindow(
                                {
                                    spice: data.spice,
                                    xtermjs: data.serial,
                                },
                                'kvm',
                                info.vmid,
                                info.node,
                                info.name,
                            );
                        },
                    });
                },
            },
        ];

	me.callParent();
    },
});

Ext.define('PVE.form.AgentFeatureSelector', {
    extend: 'Proxmox.panel.InputPanel',
    alias: ['widget.pveAgentFeatureSelector'],

    viewModel: {},

    items: [
        {
            xtype: 'proxmoxcheckbox',
            boxLabel: gettext('Use QEMU Guest Agent'),
            name: 'enabled',
            reference: 'enabled',
            uncheckedValue: 0,
        },
        {
            xtype: 'proxmoxcheckbox',
            boxLabel: gettext('Run guest-trim after a disk move or VM migration'),
            name: 'fstrim_cloned_disks',
            bind: {
                disabled: '{!enabled.checked}',
            },
            disabled: true,
        },
        {
            xtype: 'proxmoxcheckbox',
            boxLabel: gettext(
                'Freeze/thaw guest filesystems during certain operations for consistency',
            ),
            name: 'freeze-fs',
            reference: 'freeze_fs',
            bind: {
                disabled: '{!enabled.checked}',
            },
            disabled: true,
            uncheckedValue: '0',
            defaultValue: '1',
        },
        {
            xtype: 'displayfield',
            userCls: 'pmx-hint',
            value: gettext(
                'Freeze/thaw for guest filesystems disabled. This can lead to inconsistent disk images during snapshots, backups, and similar operations.',
            ),
            bind: {
                hidden: '{freeze_fs.checked}',
            },
        },
        {
            xtype: 'displayfield',
            userCls: 'pmx-hint',
            value: gettext('Make sure the QEMU Guest Agent is installed in the VM'),
            bind: {
                hidden: '{!enabled.checked}',
            },
        },
    ],

    advancedItems: [
        {
            xtype: 'proxmoxKVComboBox',
            name: 'type',
            value: '__default__',
            deleteEmpty: false,
            fieldLabel: 'Type',
            comboItems: [
                ['__default__', Proxmox.Utils.defaultText + ' (VirtIO)'],
                ['virtio', 'VirtIO'],
                ['isa', 'ISA'],
            ],
        },
    ],

    onGetValues: function (values) {
        if (PVE.Parser.parseBoolean(values['freeze-fs'])) {
            delete values['freeze-fs'];
        }

        const agentstr = PVE.Parser.printPropertyString(values, 'enabled');
        return { agent: agentstr };
    },

    setValues: function (values) {
        let res = PVE.Parser.parsePropertyString(values.agent, 'enabled');
        // cope with older backends that still return the previous name
        if (Ext.isDefined(res['freeze-fs-on-backup']) && !Ext.isDefined(res['freeze-fs'])) {
            res['freeze-fs'] = res['freeze-fs-on-backup'];
        }
        delete res['freeze-fs-on-backup'];

        if (!Ext.isDefined(res['freeze-fs'])) {
            res['freeze-fs'] = 1;
        }

        this.callParent([res]);
    },
});

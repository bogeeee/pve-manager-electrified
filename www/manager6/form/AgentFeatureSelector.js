Ext.define('PVE.form.AgentFeatureSelector', {
    extend: 'Proxmox.panel.InputPanel',
    alias: ['widget.pveAgentFeatureSelector'],

    viewModel: {},

    items: [
        {
            xtype: 'proxmoxcheckbox',
            boxLabel: Ext.String.format(gettext('Use {0}'), 'QEMU Guest Agent'),
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
            boxLabel: gettext('Freeze/thaw guest filesystems on backup for consistency'),
            name: 'freeze-fs-on-backup',
            reference: 'freeze_fs_on_backup',
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
                'Freeze/thaw for guest filesystems disabled. This can lead to inconsistent disk backups.',
            ),
            bind: {
                hidden: '{freeze_fs_on_backup.checked}',
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
        if (PVE.Parser.parseBoolean(values['freeze-fs-on-backup'])) {
            delete values['freeze-fs-on-backup'];
        }

        const agentstr = PVE.Parser.printPropertyString(values, 'enabled');
        return { agent: agentstr };
    },

    setValues: function (values) {
        let res = PVE.Parser.parsePropertyString(values.agent, 'enabled');
        if (!Ext.isDefined(res['freeze-fs-on-backup'])) {
            res['freeze-fs-on-backup'] = 1;
        }

        this.callParent([res]);
    },
});

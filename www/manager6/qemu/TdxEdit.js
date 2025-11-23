Ext.define('PVE.qemu.TdxInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveTdxInputPanel',

    onlineHelp: 'qm_memory', // TODO: change to 'qm_memory_encryption' one available

    viewModel: {
        data: {
            type: '__default__',
            attestation: 1,
        },
        formulas: {
            tdxEnabled: (get) => get('type') === 'tdx',
            attestationEnabled: (get) => Number(get('attestation')) === 1,
        },
    },

    onGetValues: function (values) {
        if (values.delete === 'type') {
            values.delete = 'intel-tdx';
            return values;
        }
        let ret = {};
        ret['intel-tdx'] = PVE.Parser.printPropertyString(values, 'type');
        return ret;
    },

    setValues: function (values) {
        this.callParent(arguments);
    },

    items: [
        {
            xtype: 'proxmoxKVComboBox',
            fieldLabel: gettext('Intel TDX Type'),
            labelWidth: 150,
            name: 'type',
            value: '__default__',
            comboItems: [
                [
                    '__default__',
                    Proxmox.Utils.defaultText + ' (' + Proxmox.Utils.disabledText + ')',
                ],
                ['tdx', 'Intel TDX'],
            ],
            bind: {
                value: '{type}',
            },
        },
        {
            xtype: 'displayfield',
            userCls: 'pmx-hint',
            value: gettext('WARNING: When using Intel TDX no EFI disk is loaded as pflash.'),
            bind: {
                hidden: '{!tdxEnabled}',
            },
        },
        {
            xtype: 'displayfield',
            userCls: 'pmx-hint',
            value: gettext(
                'Note: Intel TDX is only supported by specific recent CPU models and requires host kernel version 6.16 or higher.',
            ),
            bind: {
                hidden: '{!tdxEnabled}',
            },
        },
    ],

    advancedItems: [
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('Enable Attestation'),
            labelWidth: 150,
            name: 'attestation',
            value: 1,
            uncheckedValue: 0,
            bind: {
                value: '{attestation}',
                hidden: '{!tdxEnabled}',
                disabled: '{!tdxEnabled}',
            },
        },
        {
            xtype: 'proxmoxintegerfield',
            fieldLabel: gettext('CID'),
            labelWidth: 150,
            name: 'vsock-cid',
            minValue: 2,
            value: '2',
            allowBlank: false,
            bind: {
                hidden: '{!tdxEnabled}',
                disabled: '{!attestationEnabled || !tdxEnabled}',
            },
        },
        {
            xtype: 'proxmoxintegerfield',
            fieldLabel: gettext('Port'),
            labelWidth: 150,
            name: 'vsock-port',
            minValue: 0,
            value: '4050',
            allowBlank: false,
            bind: {
                hidden: '{!tdxEnabled}',
                disabled: '{!attestationEnabled || !tdxEnabled}',
            },
        },
    ],
});

Ext.define('PVE.qemu.TdxEdit', {
    extend: 'Proxmox.window.Edit',

    subject: 'Intel Trust Domain Extension (TDX)',

    items: {
        xtype: 'pveTdxInputPanel',
    },

    width: 400,

    initComponent: function () {
        let me = this;

        me.callParent();

        me.load({
            success: function (response) {
                let conf = response.result.data;
                let intel_tdx = conf['intel-tdx'] || '__default__';
                me.setValues(PVE.Parser.parsePropertyString(intel_tdx, 'type'));
            },
        });
    },
});

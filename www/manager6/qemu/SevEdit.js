Ext.define('PVE.qemu.SevInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveSevInputPanel',

    onlineHelp: 'qm_memory', // TODO: change to 'qm_memory_encryption' one available

    viewModel: {
        data: {
            type: '__default__',
        },
        formulas: {
            sevEnabled: (get) =>
                get('type') === 'std' || get('type') === 'es' || get('type') === 'snp',
            snpEnabled: (get) => get('type') === 'snp',
        },
    },

    onGetValues: function (values) {
        if (values.delete === 'type') {
            values.delete = 'amd-sev';
            return values;
        }
        if (!values.debug) {
            values['no-debug'] = 1;
        }
        if (!values.smt && values.type === 'snp') {
            values['allow-smt'] = 0;
        }
        if (!values['key-sharing'] && values.type !== 'snp') {
            values['no-key-sharing'] = 1;
        }
        delete values.debug;
        delete values.smt;
        delete values['key-sharing'];
        let ret = {};
        ret['amd-sev'] = PVE.Parser.printPropertyString(values, 'type');
        return ret;
    },

    setValues: function (values) {
        if (PVE.Parser.parseBoolean(values['no-debug'])) {
            values.debug = 0;
        }
        values.smt = PVE.Parser.parseBoolean(values['allow-smt'], 1);
        if (PVE.Parser.parseBoolean(values['no-key-sharing'])) {
            values['key-sharing'] = 0;
        }
        this.callParent(arguments);
    },

    items: [
        {
            xtype: 'proxmoxKVComboBox',
            fieldLabel: gettext('AMD SEV Type'),
            labelWidth: 150,
            name: 'type',
            value: '__default__',
            comboItems: [
                [
                    '__default__',
                    Proxmox.Utils.defaultText + ' (' + Proxmox.Utils.disabledText + ')',
                ],
                ['std', 'AMD SEV'],
                ['es', 'AMD SEV-ES'],
                ['snp', 'AMD SEV-SNP'],
            ],
            bind: {
                value: '{type}',
            },
        },
        {
            xtype: 'displayfield',
            userCls: 'pmx-hint',
            value: gettext('WARNING: When using SEV-SNP no EFI disk is loaded as pflash.'),
            bind: {
                hidden: '{!snpEnabled}',
            },
        },
        {
            xtype: 'displayfield',
            userCls: 'pmx-hint',
            value: gettext('Note: SEV-SNP requires host kernel version 6.11 or higher.'),
            bind: {
                hidden: '{!snpEnabled}',
            },
        },
    ],

    advancedItems: [
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('Allow Debugging'),
            labelWidth: 150,
            name: 'debug',
            value: 1,
            bind: {
                hidden: '{!sevEnabled}',
                disabled: '{!sevEnabled}',
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('Allow Key-Sharing'),
            labelWidth: 150,
            name: 'key-sharing',
            value: 1,
            bind: {
                hidden: '{!sevEnabled || snpEnabled}',
                disabled: '{!sevEnabled || snpEnabled}',
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('Allow SMT'),
            labelWidth: 150,
            name: 'smt',
            value: 1,
            bind: {
                hidden: '{!snpEnabled}',
                disabled: '{!snpEnabled}',
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('Enable Kernel Hashes'),
            labelWidth: 150,
            name: 'kernel-hashes',
            deleteDefaultValue: false,
            bind: {
                hidden: '{!sevEnabled}',
                disabled: '{!sevEnabled}',
            },
        },
    ],
});

Ext.define('PVE.qemu.SevEdit', {
    extend: 'Proxmox.window.Edit',

    subject: 'AMD Secure Encrypted Virtualization (SEV)',

    items: {
        xtype: 'pveSevInputPanel',
    },

    width: 400,

    initComponent: function () {
        let me = this;

        me.callParent();

        me.load({
            success: function (response) {
                let conf = response.result.data;
                let amd_sev = conf['amd-sev'] || '__default__';
                me.setValues(PVE.Parser.parsePropertyString(amd_sev, 'type'));
            },
        });
    },
});

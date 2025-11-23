Ext.define('PVE.storage.CephFSInputPanel', {
    extend: 'PVE.panel.StorageBase',
    controller: 'cephstorage',

    onlineHelp: 'storage_cephfs',

    viewModel: {
        type: 'cephstorage',
    },

    setValues: function (values) {
        if (values.monhost) {
            this.viewModel.set('pveceph', false);
            this.lookupReference('pvecephRef').setValue(false);
            this.lookupReference('pvecephRef').resetOriginalValue();
        }
        this.callParent([values]);
    },

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            me.nodename = 'localhost';
        }
        me.type = 'cephfs';

        me.column1 = [];

        me.column1.push(
            {
                xtype: 'textfield',
                name: 'monhost',
                vtype: 'HostList',
                value: '',
                bind: {
                    disabled: '{pveceph}',
                    submitValue: '{!pveceph}',
                    hidden: '{pveceph}',
                },
                fieldLabel: 'Monitor(s)',
                allowBlank: false,
            },
            {
                xtype: 'displayfield',
                reference: 'monhost',
                bind: {
                    disabled: '{!pveceph}',
                    hidden: '{!pveceph}',
                },
                value: '',
                fieldLabel: 'Monitor(s)',
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'username',
                value: 'admin',
                bind: {
                    disabled: '{pveceph}',
                    submitValue: '{!pveceph}',
                },
                fieldLabel: gettext('User name'),
                allowBlank: true,
            },
        );

        if (me.isCreate) {
            me.column1.push(
                {
                    xtype: 'pveCephFSSelector',
                    nodename: me.nodename,
                    name: 'fs-name',
                    bind: {
                        disabled: '{!pveceph}',
                        submitValue: '{pveceph}',
                        hidden: '{!pveceph}',
                    },
                    fieldLabel: gettext('FS Name'),
                    allowBlank: false,
                },
                {
                    xtype: 'textfield',
                    nodename: me.nodename,
                    name: 'fs-name',
                    bind: {
                        disabled: '{pveceph}',
                        submitValue: '{!pveceph}',
                        hidden: '{pveceph}',
                    },
                    fieldLabel: gettext('FS Name'),
                },
            );
        }

        me.column2 = [
            {
                xtype: 'pveContentTypeSelector',
                cts: ['backup', 'iso', 'vztmpl', 'snippets', 'import'],
                fieldLabel: gettext('Content'),
                name: 'content',
                value: 'backup',
                multiSelect: true,
                allowBlank: false,
            },
        ];

        me.columnB = [
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'keyring',
                fieldLabel: gettext('Secret Key'),
                value: me.isCreate ? '' : '***********',
                allowBlank: false,
                bind: {
                    hidden: '{pveceph}',
                    disabled: '{pveceph}',
                },
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'pveceph',
                reference: 'pvecephRef',
                bind: {
                    disabled: '{!pvecephPossible}',
                    value: '{pveceph}',
                },
                checked: true,
                uncheckedValue: 0,
                submitValue: false,
                hidden: !me.isCreate,
                boxLabel: gettext('Use Proxmox VE managed hyper-converged cephFS'),
            },
        ];

        me.callParent();
    },
});

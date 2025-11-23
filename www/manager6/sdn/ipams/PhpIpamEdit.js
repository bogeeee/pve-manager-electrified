Ext.define('PVE.sdn.ipams.PhpIpamInputPanel', {
    extend: 'PVE.panel.SDNIpamBase',

    onlineHelp: 'pvesdn_ipam_plugin_phpipam',

    onGetValues: function (values) {
        var me = this;

        if (me.isCreate) {
            values.type = me.type;
        } else {
            delete values.ipam;
        }

        return values;
    },

    initComponent: function () {
        var me = this;

        me.column1 = [
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'ipam',
                maxLength: 10,
                value: me.zone || '',
                fieldLabel: 'ID',
                allowBlank: false,
            },
            {
                xtype: 'textfield',
                name: 'token',
                fieldLabel: gettext('Token'),
                allowBlank: false,
            },
        ];
        me.column2 = [
            {
                xtype: 'textfield',
                name: 'url',
                fieldLabel: gettext('URL'),
                allowBlank: false,
            },
            {
                xtype: 'textfield',
                name: 'section',
                fieldLabel: gettext('Section'),
                allowBlank: false,
            },
        ];

        me.columnB = [
            {
                xtype: 'pmxFingerprintField',
                name: 'fingerprint',
                value: me.isCreate ? null : undefined,
                deleteEmpty: !me.isCreate,
            },
        ];

        me.callParent();
    },
});

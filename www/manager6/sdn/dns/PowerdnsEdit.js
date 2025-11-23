Ext.define('PVE.sdn.dns.PowerdnsInputPanel', {
    extend: 'PVE.panel.SDNDnsBase',

    onlineHelp: 'pvesdn_dns_plugin_powerdns',

    onGetValues: function (values) {
        var me = this;

        if (me.isCreate) {
            values.type = me.type;
        } else {
            delete values.dns;
        }

        return values;
    },

    initComponent: function () {
        var me = this;

        me.column1 = [
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'dns',
                maxLength: 10,
                value: me.dns || '',
                fieldLabel: 'ID',
                allowBlank: false,
            },
            {
                xtype: 'textfield',
                name: 'key',
                fieldLabel: gettext('API Key'),
                allowBlank: false,
            },
        ];
        me.column2 = [
            {
                xtype: 'textfield',
                name: 'url',
                fieldLabel: 'URL',
                allowBlank: false,
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'ttl',
                fieldLabel: 'TTL',
                allowBlank: true,
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

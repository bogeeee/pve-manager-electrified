Ext.define('PVE.storage.ESXIInputPanel', {
    extend: 'PVE.panel.StorageBase',

    setValues: function (values) {
        let me = this;

        let server = values.server;
        if (values.port !== undefined) {
            if (Proxmox.Utils.IP6_match.test(server)) {
                server = `[${server}]`;
            }
            server += `:${values.port}`;
        }
        values.server = server;

        return me.callParent([values]);
    },

    onGetValues: function (values) {
        let me = this;

        if (values.password?.length === 0) {
            delete values.password;
        }
        if (values.username?.length === 0) {
            delete values.username;
        }

        if (me.isCreate) {
            let serverPortMatch = Proxmox.Utils.HostPort_match.exec(values.server);
            if (serverPortMatch === null) {
                serverPortMatch = Proxmox.Utils.HostPortBrackets_match.exec(values.server);
                if (serverPortMatch === null) {
                    serverPortMatch = Proxmox.Utils.IP6_dotnotation_match.exec(values.server);
                }
            }

            if (serverPortMatch !== null) {
                values.server = serverPortMatch[1];
                if (serverPortMatch[2] !== undefined) {
                    values.port = serverPortMatch[2];
                }
            }
        }

        return me.callParent([values]);
    },

    initComponent: function () {
        var me = this;

        me.column1 = [
            {
                xtype: 'pmxDisplayEditField',
                name: 'server',
                fieldLabel: gettext('Server'),
                editable: me.isCreate,
                emptyText: gettext('IP address or hostname'),
                allowBlank: false,
            },
            {
                xtype: 'textfield',
                name: 'username',
                fieldLabel: gettext('Username'),
                allowBlank: false,
            },
            {
                xtype: 'proxmoxtextfield',
                name: 'password',
                fieldLabel: gettext('Password'),
                inputType: 'password',
                emptyText: gettext('Unchanged'),
                minLength: 1,
                allowBlank: !me.isCreate,
            },
        ];

        me.column2 = [
            {
                xtype: 'proxmoxcheckbox',
                name: 'skip-cert-verification',
                fieldLabel: gettext('Skip Certificate Verification'),
                value: false,
                uncheckedValue: 0,
                defaultValue: 0,
                deleteDefaultValue: !me.isCreate,
            },
        ];

        me.callParent();
    },
});

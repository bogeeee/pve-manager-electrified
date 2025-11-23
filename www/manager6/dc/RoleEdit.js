Ext.define('PVE.dc.RoleEdit', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveDcRoleEdit',

    width: 400,

    initComponent: function () {
        var me = this;

        me.isCreate = !me.roleid;

        var url;
        var method;

        if (me.isCreate) {
            url = '/api2/extjs/access/roles';
            method = 'POST';
        } else {
            url = '/api2/extjs/access/roles/' + me.roleid;
            method = 'PUT';
        }

        Ext.applyIf(me, {
            subject: gettext('Role'),
            url: url,
            method: method,
            items: [
                {
                    xtype: me.isCreate ? 'proxmoxtextfield' : 'displayfield',
                    name: 'roleid',
                    value: me.roleid,
                    allowBlank: false,
                    fieldLabel: gettext('Name'),
                },
                {
                    xtype: 'pvePrivilegesSelector',
                    name: 'privs',
                    value: me.privs,
                    allowBlank: false,
                    fieldLabel: gettext('Privileges'),
                },
            ],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response) {
                    var data = response.result.data;
                    var keys = Ext.Object.getKeys(data);

                    me.setValues({
                        privs: keys,
                        roleid: me.roleid,
                    });
                },
            });
        }
    },
});

Ext.define('PVE.form.PrivilegesSelector', {
    extend: 'Proxmox.form.KVComboBox',
    xtype: 'pvePrivilegesSelector',

    multiSelect: true,

    initComponent: function () {
        let me = this;

        me.callParent();

        Proxmox.Utils.API2Request({
            url: '/access/roles/Administrator',
            method: 'GET',
            success: function (response, options) {
                let data = Object.keys(response.result.data).map((key) => [key, key]);

                me.store.setData(data);

                me.store.sort({
                    property: 'key',
                    direction: 'ASC',
                });
            },
            failure: (response, opts) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
        });
    },
});

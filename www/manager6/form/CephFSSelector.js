Ext.define('PVE.form.CephFSSelector', {
    extend: 'Ext.form.field.ComboBox',
    alias: 'widget.pveCephFSSelector',

    allowBlank: false,
    valueField: 'name',
    displayField: 'name',
    editable: false,
    queryMode: 'local',

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no nodename given';
        }

        var store = Ext.create('Ext.data.Store', {
            fields: ['name'],
            sorters: 'name',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/nodes/' + me.nodename + '/ceph/fs',
            },
        });

        Ext.apply(me, {
            store: store,
        });

        me.callParent();

        store.load({
            callback: function (rec, op, success) {
                if (success && rec.length > 0) {
                    me.select(rec[0]);
                }
            },
        });
    },
});

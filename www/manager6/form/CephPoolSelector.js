Ext.define('PVE.form.CephPoolSelector', {
    extend: 'Ext.form.field.ComboBox',
    alias: 'widget.pveCephPoolSelector',

    allowBlank: false,
    valueField: 'pool_name',
    displayField: 'pool_name',
    listConfig: {
        itemTpl: '{pool_name:htmlEncode}',
    },
    editable: false,
    queryMode: 'local',

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no nodename given';
        }

        let onlyRBDPools = ({ data }) =>
            !data?.application_metadata || !!data?.application_metadata?.rbd;

        var store = Ext.create('Ext.data.Store', {
            fields: ['name'],
            sorters: 'name',
            filters: [onlyRBDPools],
            proxy: {
                type: 'proxmox',
                url: '/api2/json/nodes/' + me.nodename + '/ceph/pool',
            },
        });

        Ext.apply(me, {
            store: store,
        });

        me.callParent();

        store.load({
            callback: function (rec, op, success) {
                let filteredRec = rec.filter(onlyRBDPools);

                if (success && filteredRec.length > 0) {
                    me.select(filteredRec[0]);
                }
            },
        });
    },
});

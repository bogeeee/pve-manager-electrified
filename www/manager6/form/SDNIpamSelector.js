Ext.define(
    'PVE.form.SDNIpamSelector',
    {
        extend: 'Proxmox.form.ComboGrid',
        alias: ['widget.pveSDNIpamSelector'],

        allowBlank: false,
        valueField: 'ipam',
        displayField: 'ipam',

        initComponent: function () {
            var me = this;

            var store = new Ext.data.Store({
                model: 'pve-sdn-ipam',
                sorters: {
                    property: 'ipam',
                    direction: 'ASC',
                },
            });

            Ext.apply(me, {
                store: store,
                autoSelect: false,
                listConfig: {
                    columns: [
                        {
                            header: gettext('Ipam'),
                            sortable: true,
                            dataIndex: 'ipam',
                            flex: 1,
                        },
                    ],
                },
            });

            me.callParent();

            store.load();
        },
    },
    function () {
        Ext.define('pve-sdn-ipam', {
            extend: 'Ext.data.Model',
            fields: ['ipam'],
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/sdn/ipams',
            },
            idProperty: 'ipam',
        });
    },
);

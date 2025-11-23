Ext.define(
    'PVE.form.SDNDnsSelector',
    {
        extend: 'Proxmox.form.ComboGrid',
        alias: ['widget.pveSDNDnsSelector'],

        allowBlank: false,
        valueField: 'dns',
        displayField: 'dns',

        initComponent: function () {
            var me = this;

            var store = new Ext.data.Store({
                model: 'pve-sdn-dns',
                sorters: {
                    property: 'dns',
                    direction: 'ASC',
                },
            });

            Ext.apply(me, {
                store: store,
                autoSelect: false,
                listConfig: {
                    columns: [
                        {
                            header: gettext('dns'),
                            sortable: true,
                            dataIndex: 'dns',
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
        Ext.define('pve-sdn-dns', {
            extend: 'Ext.data.Model',
            fields: ['dns'],
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/sdn/dns',
            },
            idProperty: 'dns',
        });
    },
);

Ext.define('PVE.sdn.DnsView', {
    extend: 'Ext.grid.GridPanel',
    alias: ['widget.pveSDNDnsView'],

    stateful: true,
    stateId: 'grid-sdn-dns',

    createSDNEditWindow: function (type, sid) {
        let schema = PVE.Utils.sdndnsSchema[type];
        if (!schema || !schema.ipanel) {
            throw 'no editor registered for dns type: ' + type;
        }

        Ext.create('PVE.sdn.dns.BaseEdit', {
            paneltype: 'PVE.sdn.dns.' + schema.ipanel,
            type: type,
            dns: sid,
            autoShow: true,
            listeners: {
                destroy: this.reloadStore,
            },
        });
    },

    initComponent: function () {
        let me = this;

        let store = new Ext.data.Store({
            model: 'pve-sdn-dns',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/sdn/dns',
            },
            sorters: {
                property: 'dns',
                direction: 'ASC',
            },
        });

        let sm = Ext.create('Ext.selection.RowModel', {});

        let run_editor = function () {
            let rec = sm.getSelection()[0];
            if (!rec) {
                return;
            }
            let type = rec.data.type,
                dns = rec.data.dns;

            me.createSDNEditWindow(type, dns);
        };

        let edit_btn = new Proxmox.button.Button({
            text: gettext('Edit'),
            disabled: true,
            selModel: sm,
            handler: run_editor,
        });

        let remove_btn = Ext.create('Proxmox.button.StdRemoveButton', {
            selModel: sm,
            baseurl: '/cluster/sdn/dns/',
            callback: () => store.load(),
        });

        // else we cannot dynamically generate the add menu handlers
        let addHandleGenerator = function (type) {
            return function () {
                me.createSDNEditWindow(type);
            };
        };
        let addMenuItems = [];
        for (const [type, dns] of Object.entries(PVE.Utils.sdndnsSchema)) {
            if (dns.hideAdd) {
                continue;
            }
            addMenuItems.push({
                text: PVE.Utils.format_sdndns_type(type),
                iconCls: 'fa fa-fw fa-' + dns.faIcon,
                handler: addHandleGenerator(type),
            });
        }

        Ext.apply(me, {
            store: store,
            reloadStore: () => store.load(),
            selModel: sm,
            viewConfig: {
                trackOver: false,
            },
            tbar: [
                {
                    text: gettext('Add'),
                    menu: new Ext.menu.Menu({
                        items: addMenuItems,
                    }),
                },
                remove_btn,
                edit_btn,
            ],
            columns: [
                {
                    header: 'ID',
                    flex: 2,
                    dataIndex: 'dns',
                    renderer: Ext.htmlEncode,
                },
                {
                    header: gettext('Type'),
                    flex: 1,
                    dataIndex: 'type',
                    renderer: PVE.Utils.format_sdndns_type,
                },
                {
                    header: 'url',
                    flex: 1,
                    dataIndex: 'url',
                    renderer: Ext.htmlEncode,
                },
            ],
            listeners: {
                activate: () => store.load(),
                itemdblclick: run_editor,
            },
        });

        store.load();
        me.callParent();
    },
});

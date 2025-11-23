Ext.define('PVE.sdn.Fabric.InterfacePanel', {
    extend: 'Ext.grid.Panel',
    mixins: ['Ext.form.field.Field'],

    xtype: 'pveSDNFabricsInterfacePanel',

    nodeInterfaces: {},

    selModel: {
        mode: 'SIMPLE',
        type: 'checkboxmodel',
    },

    commonColumns: [
        {
            text: gettext('Status'),
            dataIndex: 'status',
            width: 30,
            renderer: function (value, metaData, record) {
                let me = this;

                let warning;
                let nodeInterface = me.nodeInterfaces[record.data.name];

                if (!nodeInterface) {
                    warning = gettext('Interface does not exist on node');
                } else if (
                    (nodeInterface.ip && record.data.ip) ||
                    (nodeInterface.ip6 && record.data.ip6)
                ) {
                    warning = gettext(
                        'Interface already has an address configured in /etc/network/interfaces',
                    );
                } else if (nodeInterface.ip || nodeInterface.ip6) {
                    warning = gettext(
                        'Configure the IP in the fabric, instead of /etc/network/interfaces',
                    );
                }

                if (warning) {
                    metaData.tdAttr = `data-qtip="${Ext.htmlEncode(Ext.htmlEncode(warning))}"`;
                    return `<i class="fa warning fa-warning"></i>`;
                }

                return '';
            },
        },
        {
            text: gettext('Name'),
            dataIndex: 'name',
            flex: 2,
        },
        {
            text: gettext('Type'),
            dataIndex: 'type',
            flex: 1,
        },
        {
            text: gettext('IP'),
            xtype: 'widgetcolumn',
            dataIndex: 'ip',
            flex: 1,
            widget: {
                xtype: 'proxmoxtextfield',
                isFormField: false,
                bind: {
                    disabled: '{record.isDisabled}',
                },
            },
        },
    ],

    additionalColumns: [],

    controller: {
        onValueChange: function (field, value) {
            let me = this;

            let record = field.getWidgetRecord();

            if (!record) {
                return;
            }

            let column = field.getWidgetColumn();

            record.set(column.dataIndex, value);
            record.commit();

            me.getView().checkChange();
        },

        control: {
            field: {
                change: 'onValueChange',
            },
        },
    },

    listeners: {
        selectionchange: function () {
            this.checkChange();
        },
    },

    initComponent: function () {
        let me = this;

        Ext.apply(me, {
            store: Ext.create('Ext.data.Store', {
                model: 'Pve.sdn.Interface',
                sorters: {
                    property: 'name',
                    direction: 'ASC',
                },
            }),
            columns: me.commonColumns.concat(me.additionalColumns),
        });

        me.callParent();

        Proxmox.Utils.monStoreErrors(me, me.getStore(), true);
        me.initField();
    },

    setNodeInterfaces: function (interfaces) {
        let me = this;

        let nodeInterfaces = {};
        for (const iface of interfaces) {
            nodeInterfaces[iface.name] = iface;
        }

        me.nodeInterfaces = nodeInterfaces;

        // reset value when setting new available interfaces
        me.setValue([]);
    },

    getValue: function () {
        let me = this;

        return me.getSelection().map((rec) => {
            let data = {};

            for (const [key, value] of Object.entries(rec.data)) {
                if (value === '' || value === undefined || value === null) {
                    continue;
                }

                if (['type', 'isDisabled'].includes(key)) {
                    continue;
                }

                data[key] = value;
            }

            return PVE.Parser.printPropertyString(data);
        });
    },

    setValue: function (value) {
        let me = this;

        let store = me.getStore();

        let selection = me.getSelectionModel();
        selection.deselectAll();

        let data = structuredClone(me.nodeInterfaces);

        for (const iface of Object.values(data)) {
            iface.isDisabled = iface.ip || iface.ip6;
        }

        let selected = [];
        let fabricInterfaces = structuredClone(value);

        for (let iface of fabricInterfaces) {
            iface = PVE.Parser.parsePropertyString(iface);

            selected.push(iface.name);

            // if the fabric configuration defines an interface that was
            // previously disabled, re-enable the field to allow editing of the
            // value set in the fabric - we show a warning as well if there is
            // already an IP configured in /e/n/i
            iface.isDisabled = false;

            if (Object.hasOwn(data, iface.name)) {
                data[iface.name] = {
                    ...data[iface.name],
                    // fabric properties have precedence
                    ...iface,
                };
            } else {
                data[iface.name] = iface;
            }
        }

        store.setData(Object.values(data));

        let selected_records = selected.map((name) => store.findRecord('name', name));
        selection.select(selected_records);

        me.resetOriginalValue();
    },

    getSubmitData: function () {
        let me = this;

        let name = me.getName();
        let value = me.getValue();

        if (value.length === 0 && !me.isCreate) {
            return {
                delete: name,
            };
        }

        return {
            [name]: value,
        };
    },
});

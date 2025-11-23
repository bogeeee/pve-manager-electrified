Ext.define('PVE.sdn.SubnetInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    mixins: ['Proxmox.Mixin.CBind'],

    onGetValues: function (values) {
        let me = this;

        if (me.isCreate) {
            values.type = 'subnet';
            values.subnet = values.cidr;
            delete values.cidr;
        }

        return values;
    },

    items: [
        {
            xtype: 'pmxDisplayEditField',
            name: 'cidr',
            cbind: {
                editable: '{isCreate}',
            },
            flex: 1,
            allowBlank: false,
            fieldLabel: gettext('Subnet'),
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'gateway',
            vtype: 'IP64Address',
            fieldLabel: gettext('Gateway'),
            allowBlank: true,
            skipEmptyText: true,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            name: 'snat',
            uncheckedValue: null,
            checked: false,
            fieldLabel: 'SNAT',
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'dnszoneprefix',
            skipEmptyText: true,
            fieldLabel: gettext('DNS Zone Prefix'),
            allowBlank: true,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
    ],
});

Ext.define('PVE.sdn.SubnetDhcpRangePanel', {
    extend: 'Ext.form.FieldContainer',
    mixins: ['Ext.form.field.Field'],

    initComponent: function () {
        let me = this;

        me.callParent();
        me.initField();
    },

    // since value is an array of objects we need to override isEquals here
    isEqual: function (value1, value2) {
        return JSON.stringify(value1) === JSON.stringify(value2);
    },

    getValue: function () {
        let me = this;
        let store = me.lookup('grid').getStore();

        let value = [];

        store.getData().each((item) => {
            // needs a deep copy otherwise we run in to ExtJS reference
            // shenaningans
            value.push({
                'start-address': item.data['start-address'],
                'end-address': item.data['end-address'],
            });
        });

        return value;
    },

    getSubmitData: function () {
        let me = this;

        let data = {};

        let value = me
            .getValue()
            .map(
                (item) =>
                    `start-address=${item['start-address']},end-address=${item['end-address']}`,
            );

        if (value.length) {
            data[me.getName()] = value;
        } else if (!me.isCreate) {
            data.delete = me.getName();
        }

        return data;
    },

    setValue: function (dhcpRanges) {
        let me = this;
        let store = me.lookup('grid').getStore();

        let data = [];

        dhcpRanges.forEach((item) => {
            // needs a deep copy otherwise we run in to ExtJS reference
            // shenaningans
            data.push({
                'start-address': item['start-address'],
                'end-address': item['end-address'],
            });
        });

        store.setData(data);
    },

    getErrors: function () {
        let _me = this;
        let errors = [];

        return errors;
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        addRange: function () {
            let me = this;
            me.lookup('grid').getStore().add({});

            me.getView().checkChange();
        },

        removeRange: function (field) {
            let me = this;
            let record = field.getWidgetRecord();

            me.lookup('grid').getStore().remove(record);

            me.getView().checkChange();
        },

        onValueChange: function (field, value) {
            let me = this;
            let record = field.getWidgetRecord();
            let column = field.getWidgetColumn();

            record.set(column.dataIndex, value);
            record.commit();

            me.getView().checkChange();
        },

        control: {
            'grid button': {
                click: 'removeRange',
            },
            field: {
                change: 'onValueChange',
            },
        },
    },

    items: [
        {
            xtype: 'grid',
            reference: 'grid',
            scrollable: true,
            store: {
                fields: ['start-address', 'end-address'],
            },
            columns: [
                {
                    text: gettext('Start Address'),
                    xtype: 'widgetcolumn',
                    dataIndex: 'start-address',
                    flex: 1,
                    widget: {
                        xtype: 'textfield',
                        vtype: 'IP64Address',
                    },
                },
                {
                    text: gettext('End Address'),
                    xtype: 'widgetcolumn',
                    dataIndex: 'end-address',
                    flex: 1,
                    widget: {
                        xtype: 'textfield',
                        vtype: 'IP64Address',
                    },
                },
                {
                    xtype: 'widgetcolumn',
                    width: 40,
                    widget: {
                        xtype: 'button',
                        iconCls: 'fa fa-trash-o',
                    },
                },
            ],
        },
        {
            xtype: 'container',
            layout: {
                type: 'hbox',
            },
            items: [
                {
                    xtype: 'button',
                    text: gettext('Add'),
                    iconCls: 'fa fa-plus-circle',
                    handler: 'addRange',
                },
            ],
        },
    ],
});

Ext.define('PVE.sdn.SubnetEdit', {
    extend: 'Proxmox.window.Edit',

    subject: gettext('Subnet'),

    subnet: undefined,

    width: 350,

    base_url: undefined,

    bodyPadding: 0,

    initComponent: function () {
        var me = this;

        me.isCreate = me.subnet === undefined;

        if (me.isCreate) {
            me.url = me.base_url;
            me.method = 'POST';
        } else {
            me.url = me.base_url + '/' + me.subnet;
            me.method = 'PUT';
        }

        let ipanel = Ext.create('PVE.sdn.SubnetInputPanel', {
            isCreate: me.isCreate,
            title: gettext('General'),
        });

        let dhcpPanel = Ext.create('PVE.sdn.SubnetDhcpRangePanel', {
            isCreate: me.isCreate,
            title: gettext('DHCP Ranges'),
            name: 'dhcp-range',
        });

        Ext.apply(me, {
            items: [
                {
                    xtype: 'tabpanel',
                    bodyPadding: 10,
                    items: [ipanel, dhcpPanel],
                },
            ],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response, options) {
                    me.setValues(response.result.data);
                },
            });
        }
    },
});

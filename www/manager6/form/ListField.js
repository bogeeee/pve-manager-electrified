Ext.define('PVE.form.ListField', {
    extend: 'Ext.container.Container',
    alias: 'widget.pveListField',

    mixins: ['Ext.form.field.Field'],

    // override for column header
    fieldTitle: gettext('Item'),

    // will be applied to the textfields
    maskRe: undefined,

    allowBlank: true,
    selectAll: false,
    isFormField: true,
    deleteEmpty: false,
    config: {
        deleteEmpty: false,
    },

    setValue: function (list) {
        let me = this;
        list = Ext.isArray(list) ? list : (list ?? '').split(';').filter((t) => t !== '');

        let store = me.lookup('grid').getStore();
        if (list.length > 0) {
            store.setData(list.map((item) => ({ item })));
        } else {
            store.removeAll();
        }
        me.checkChange();
        return me;
    },

    getValue: function () {
        let me = this;
        let values = [];
        me.lookup('grid')
            .getStore()
            .each((rec) => {
                if (rec.data.item) {
                    values.push(rec.data.item);
                }
            });
        return values.join(';');
    },

    getErrors: function (value) {
        let me = this;
        let empty = false;
        me.lookup('grid')
            .getStore()
            .each((rec) => {
                if (!rec.data.item) {
                    empty = true;
                }
            });
        if (empty) {
            return [gettext('Tag must not be empty.')];
        }
        return [];
    },

    // override framework function to implement deleteEmpty behaviour
    getSubmitData: function () {
        let me = this,
            data = null,
            val;
        if (!me.disabled && me.submitValue) {
            val = me.getValue();
            if (val !== null && val !== '') {
                data = {};
                data[me.getName()] = val;
            } else if (me.getDeleteEmpty()) {
                data = {};
                data.delete = me.getName();
            }
        }
        return data;
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        addLine: function () {
            let me = this;
            me.lookup('grid').getStore().add({
                item: '',
            });
        },

        removeSelection: function (field) {
            let me = this;
            let view = me.getView();
            let grid = me.lookup('grid');

            let record = field.getWidgetRecord();
            if (record === undefined) {
                // this is sometimes called before a record/column is initialized
                return;
            }

            grid.getStore().remove(record);
            view.checkChange();
            view.validate();
        },

        itemChange: function (field, newValue) {
            let rec = field.getWidgetRecord();
            if (!rec) {
                return;
            }
            let column = field.getWidgetColumn();
            rec.set(column.dataIndex, newValue);
            let list = field.up('pveListField');
            list.checkChange();
            list.validate();
        },

        control: {
            'grid button': {
                click: 'removeSelection',
            },
        },
    },

    items: [
        {
            xtype: 'grid',
            reference: 'grid',

            viewConfig: {
                deferEmptyText: false,
            },

            store: {
                listeners: {
                    update: function () {
                        this.commitChanges();
                    },
                },
            },
        },
        {
            xtype: 'button',
            text: gettext('Add'),
            iconCls: 'fa fa-plus-circle',
            handler: 'addLine',
            margin: '5 0 0 0',
        },
    ],

    initComponent: function () {
        let me = this;

        for (const [key, value] of Object.entries(me.gridConfig ?? {})) {
            me.items[0][key] = value;
        }

        me.items[0].columns = [
            {
                header: me.fieldTtitle,
                dataIndex: 'item',
                xtype: 'widgetcolumn',
                widget: {
                    xtype: 'textfield',
                    isFormField: false,
                    maskRe: me.maskRe,
                    allowBlank: false,
                    queryMode: 'local',
                    listeners: {
                        change: 'itemChange',
                    },
                },
                flex: 1,
            },
            {
                xtype: 'widgetcolumn',
                width: 40,
                widget: {
                    xtype: 'button',
                    iconCls: 'fa fa-trash-o',
                },
            },
        ];

        me.callParent();
        me.initField();
    },
});

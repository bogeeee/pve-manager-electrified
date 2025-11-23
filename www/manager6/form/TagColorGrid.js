Ext.define('PVE.form.ColorPicker', {
    extend: 'Ext.form.FieldContainer',
    alias: 'widget.pveColorPicker',

    defaultBindProperty: 'value',

    config: {
        value: null,
    },

    height: 24,

    layout: {
        type: 'hbox',
        align: 'stretch',
    },

    getValue: function () {
        return this.realvalue.slice(1);
    },

    setValue: function (value) {
        let me = this;
        me.setColor(value);
        if (value && value.length === 6) {
            me.picker.value = value[0] !== '#' ? `#${value}` : value;
        }
    },

    setColor: function (value) {
        let me = this;
        let oldValue = me.realvalue;
        me.realvalue = value;
        let color = value.length === 6 ? `#${value}` : undefined;
        me.down('#picker').setStyle('background-color', color);
        me.down('#text').setValue(value ?? '');
        me.fireEvent('change', me, me.realvalue, oldValue);
    },

    initComponent: function () {
        let me = this;
        me.picker = document.createElement('input');
        me.picker.type = 'color';
        me.picker.style = `opacity: 0; border: 0px; width: 100%; height: ${me.height}px`;
        me.picker.value = `${me.value}`;

        me.items = [
            {
                xtype: 'textfield',
                itemId: 'text',
                minLength: !me.allowBlank ? 6 : undefined,
                maxLength: 6,
                enforceMaxLength: true,
                allowBlank: me.allowBlank,
                emptyText: me.allowBlank ? gettext('Automatic') : undefined,
                maskRe: /[a-f0-9]/i,
                regex: /^[a-f0-9]{6}$/i,
                flex: 1,
                listeners: {
                    change: function (field, value) {
                        me.setValue(value);
                    },
                },
            },
            {
                xtype: 'box',
                style: {
                    'margin-left': '1px',
                    border: '1px solid #cfcfcf',
                },
                itemId: 'picker',
                width: 24,
                contentEl: me.picker,
            },
        ];

        me.callParent();
        me.picker.oninput = function () {
            me.setColor(me.picker.value.slice(1));
        };
    },
});

Ext.define('PVE.form.TagColorGrid', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.pveTagColorGrid',

    mixins: ['Ext.form.field.Field'],

    allowBlank: true,
    selectAll: false,
    isFormField: true,
    deleteEmpty: false,
    selModel: 'checkboxmodel',

    config: {
        deleteEmpty: false,
    },

    emptyText: gettext('No Overrides'),
    viewConfig: {
        deferEmptyText: false,
    },

    setValue: function (value) {
        let me = this;
        let colors;
        if (Ext.isObject(value)) {
            colors = value.colors;
        } else {
            colors = value;
        }
        if (!colors) {
            me.getStore().removeAll();
            me.checkChange();
            return me;
        }
        let entries = (colors.split(';') || []).map((entry) => {
            let [tag, bg, fg] = entry.split(':');
            fg = fg || '';
            return {
                tag,
                color: bg,
                text: fg,
            };
        });
        me.getStore().setData(entries);
        me.checkChange();
        return me;
    },

    getValue: function () {
        let me = this;
        let values = [];
        me.getStore().each((rec) => {
            if (rec.data.tag) {
                let val = `${rec.data.tag}:${rec.data.color}`;
                if (rec.data.text) {
                    val += `:${rec.data.text}`;
                }
                values.push(val);
            }
        });
        return values.join(';');
    },

    getErrors: function (value) {
        let me = this;
        let emptyTag = false;
        let notValidColor = false;
        let colorRegex = new RegExp(/^[0-9a-f]{6}$/i);
        me.getStore().each((rec) => {
            if (!rec.data.tag) {
                emptyTag = true;
            }
            if (!rec.data.color?.match(colorRegex)) {
                notValidColor = true;
            }
            if (rec.data.text && !rec.data.text?.match(colorRegex)) {
                notValidColor = true;
            }
        });
        let errors = [];
        if (emptyTag) {
            errors.push(gettext('Tag must not be empty.'));
        }
        if (notValidColor) {
            errors.push(gettext('Not a valid color.'));
        }
        return errors;
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
            me.getView().getStore().add({
                tag: '',
                color: '',
                text: '',
            });
        },

        removeSelection: function () {
            let me = this;
            let view = me.getView();
            let selection = view.getSelection();
            if (selection === undefined) {
                return;
            }

            selection.forEach((sel) => {
                view.getStore().remove(sel);
            });
            view.checkChange();
        },

        tagChange: function (field, newValue, oldValue) {
            let me = this;
            let rec = field.getWidgetRecord();
            if (!rec) {
                return;
            }
            if (newValue && newValue !== oldValue) {
                let newrgb = Proxmox.Utils.stringToRGB(newValue);
                let newvalue = Proxmox.Utils.rgbToHex(newrgb);
                if (!rec.get('color')) {
                    rec.set('color', newvalue);
                } else if (oldValue) {
                    let oldrgb = Proxmox.Utils.stringToRGB(oldValue);
                    let oldvalue = Proxmox.Utils.rgbToHex(oldrgb);
                    if (rec.get('color') === oldvalue) {
                        rec.set('color', newvalue);
                    }
                }
            }
            me.fieldChange(field, newValue, oldValue);
        },

        backgroundChange: function (field, newValue, oldValue) {
            let me = this;
            let rec = field.getWidgetRecord();
            if (!rec) {
                return;
            }
            if (newValue && newValue !== oldValue) {
                let newrgb = Proxmox.Utils.hexToRGB(newValue);
                let newcls = Proxmox.Utils.getTextContrastClass(newrgb);
                let hexvalue = newcls === 'dark' ? '000000' : 'FFFFFF';
                if (!rec.get('text')) {
                    rec.set('text', hexvalue);
                } else if (oldValue) {
                    let oldrgb = Proxmox.Utils.hexToRGB(oldValue);
                    let oldcls = Proxmox.Utils.getTextContrastClass(oldrgb);
                    let oldvalue = oldcls === 'dark' ? '000000' : 'FFFFFF';
                    if (rec.get('text') === oldvalue) {
                        rec.set('text', hexvalue);
                    }
                }
            }
            me.fieldChange(field, newValue, oldValue);
        },

        fieldChange: function (field, newValue, oldValue) {
            let me = this;
            let view = me.getView();
            let rec = field.getWidgetRecord();
            if (!rec) {
                return;
            }
            let column = field.getWidgetColumn();
            rec.set(column.dataIndex, newValue);
            view.checkChange();
        },
    },

    tbar: [
        {
            text: gettext('Add'),
            handler: 'addLine',
        },
        {
            xtype: 'proxmoxButton',
            text: gettext('Remove'),
            handler: 'removeSelection',
            disabled: true,
        },
    ],

    columns: [
        {
            header: 'Tag',
            dataIndex: 'tag',
            xtype: 'widgetcolumn',
            onWidgetAttach: function (col, widget, rec) {
                widget.getStore().setData(PVE.UIOptions.tagList.map((v) => ({ tag: v })));
            },
            widget: {
                xtype: 'combobox',
                isFormField: false,
                maskRe: PVE.Utils.tagCharRegex,
                allowBlank: false,
                queryMode: 'local',
                displayField: 'tag',
                valueField: 'tag',
                store: {},
                listeners: {
                    change: 'tagChange',
                },
            },
            flex: 1,
        },
        {
            header: gettext('Background'),
            xtype: 'widgetcolumn',
            flex: 1,
            dataIndex: 'color',
            widget: {
                xtype: 'pveColorPicker',
                isFormField: false,
                listeners: {
                    change: 'backgroundChange',
                },
            },
        },
        {
            header: gettext('Text'),
            xtype: 'widgetcolumn',
            flex: 1,
            dataIndex: 'text',
            widget: {
                xtype: 'pveColorPicker',
                allowBlank: true,
                isFormField: false,
                listeners: {
                    change: 'fieldChange',
                },
            },
        },
    ],

    store: {
        listeners: {
            update: function () {
                this.commitChanges();
            },
        },
    },

    initComponent: function () {
        let me = this;
        me.callParent();
        me.initField();
    },
});
